"""Read public contact links that search snippets omit; never classify a lead."""
import hashlib
import ipaddress
import json
import socket
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


def require_public_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTP(S) pages are allowed')
    if parsed.port not in (None, 80, 443):
        raise ValueError('Non-web port rejected')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80))
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('Non-public address rejected')


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class ContactLinks(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.contacts, self.links, self.text = url, [], [], []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.ignored += 1
        if tag != 'a':
            return
        href = dict(attrs).get('href') or ''
        lowered = href.lower()
        parsed = urlsplit(urljoin(self.url, href))
        candidate, kind = '', ''
        if lowered.startswith('mailto:'):
            candidate, kind = unquote(href[7:]).split('?')[0], 'email'
        elif lowered.startswith('tel:'):
            candidate, kind = unquote(href[4:]).split('?')[0], 'phone'
        elif parsed.hostname in ('wa.me', 'api.whatsapp.com', 'web.whatsapp.com'):
            candidate = parsed.path.strip('/') if parsed.hostname == 'wa.me' else parse_qs(parsed.query).get('phone', [''])[0]
            kind = 'phone'
        if candidate:
            item = {'kind': kind, 'value': candidate[:150], 'href': href[:500]}
            if item not in self.contacts:
                self.contacts.append(item)
        if parsed.scheme in ('http', 'https') and any(term in parsed.path.lower() for term in ('contact', 'over-ons', 'about', 'privacy')):
            self.links.append(parsed.geturl())

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignored = max(0, self.ignored - 1)

    def handle_data(self, value):
        if not self.ignored and value.strip():
            self.text.append(value.strip())


def fetch_page(url):
    try:
        require_public_url(url)
        opener = build_opener(ProxyHandler({}), PublicRedirects())
        request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (SoftoraContactEvidence)', 'Accept': 'text/html'})
        with opener.open(request, timeout=15) as response:
            content = response.read(500001)
            if 'html' not in response.headers.get('Content-Type', '').lower():
                raise ValueError('Not an HTML page')
            parser = ContactLinks(response.url)
            parser.feed(content[:500000].decode('utf-8', errors='replace'))
            return {'url': url, 'final_url': response.url, 'http_status': response.status,
                    'body_sha256': hashlib.sha256(content).hexdigest(), 'truncated': len(content) > 500000,
                    'contacts': parser.contacts[:20], 'contact_links': list(dict.fromkeys(parser.links))[:8],
                    'text': ' '.join(parser.text)[:1800]}
    except Exception as error:
        return {'url': url, 'blocked': str(error)[:220]}


def public_page_evidence(result):
    website = str(result.get('website') or '')
    if not website or (result.get('telefoonnummer') and result.get('email')):
        return []
    pages = [fetch_page(website)]
    host = (urlsplit(website).hostname or '').removeprefix('www.')
    for link in pages[0].get('contact_links', []):
        if (urlsplit(link).hostname or '').removeprefix('www.') == host and link != website:
            pages.append(fetch_page(link))
            break
    return pages


def unreviewed_contacts(result, pages):
    # A candidate is not proof of identity. Ask the model to attribute or reject
    # it with evidence; never copy it automatically into the company database.
    evidence = json.dumps([result.get('field_evidence'), result.get('contact_rejections')], ensure_ascii=False).lower()
    digits = ''.join(character for character in evidence if character.isdigit())
    pending = []
    for page in pages:
        for item in page.get('contacts', []):
            field = 'email' if item['kind'] == 'email' else 'telefoonnummer'
            value = item['value']
            reviewed = value.lower() in evidence if field == 'email' else ''.join(c for c in value if c.isdigit()) in digits
            if not result.get(field) and not reviewed:
                pending.append(item)
    return pending
