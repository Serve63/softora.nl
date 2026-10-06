"""Build the public Softora ebook. Requires reportlab and SOFTORA_EBOOK_FONT_DIR.

Use Rubik-Regular.ttf and Rubik-Bold.ttf (OFL licensed). Run from any directory.
Render the PDF and inspect all pages before publishing a revised edition.
"""
import os
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/ebooks'
OUT.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path(os.environ['SOFTORA_EBOOK_FONT_DIR'])
for font, file in [('Body', 'Rubik-Regular.ttf'), ('Bold', 'Rubik-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(font, str(FONT_DIR / file)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Bold')
W, H = 595.28, 841.89
INK, WINE, MUTED, PAPER, PINK, LIME = '#2b1c2b', '#8b2055', '#70616b', '#fcf9f6', '#f0dce6', '#e5f2b2'
c = canvas.Canvas(str(OUT / 'meer-groei-minder-handwerk.pdf'), pagesize=(W, H), pageCompression=1, invariant=1)
c.setTitle('Meer groei. Minder handwerk. | Softora')
c.setAuthor('Softora')
c.setSubject('Praktische gids voor groeien met bedrijfssoftware: groeiscan, keuzehulp en 30-dagenplan')

def box(x, y, w, h, color, radius=0):
    c.setFillColor(HexColor(color))
    if radius:
        c.roundRect(x, H-y-h, w, h, radius, stroke=0, fill=1)
    else:
        c.rect(x, H-y-h, w, h, stroke=0, fill=1)

def text(value, x, y, size=11, color=INK, bold=False):
    c.setFillColor(HexColor(color)); c.setFont('Bold' if bold else 'Body', size)
    c.drawString(x, H-y-size, value)

def para(value, x, y, width=491, size=11, color=INK, bold=False, leading=None):
    p = Paragraph(value, ParagraphStyle('p', fontName='Bold' if bold else 'Body', fontSize=size,
        leading=leading or size*1.52, textColor=HexColor(color), spaceAfter=0))
    _, h = p.wrap(width, 1000)
    assert y+h < 790, f'Text outside page: {value[:65]} at {y+h}'
    p.drawOn(c, x, H-y-h)
    return y+h

def line(y, x=52, width=491, color='#ddcfd6'):
    c.setStrokeColor(HexColor(color)); c.setLineWidth(.7); c.line(x, H-y, x+width, H-y)

def page(number, section):
    box(0, 0, W, H, PAPER)
    text('SOFTORA.NL', 52, 35, 13, INK, True)
    text('MEER GROEI. MINDER HANDWERK.', 260, 40, 8, MUTED)
    line(69)
    text(section.upper(), 52, 100, 10, WINE, True)
    line(788)
    text('Softora  /  Praktische gids voor ondernemers', 52, 803, 8, MUTED)
    text(f'{number:02d} / 12', 496, 803, 8, MUTED)

def title(value, sub):
    y = para(value, 52, 129, size=30, bold=True, leading=35)
    return para(sub, 52, y+18, size=12, color=MUTED)+27

def note(value, y, label='JOUW VOLGENDE STAP', height=91):
    box(52, y, 491, height, PINK, 9)
    text(label, 70, y+15, 9, WINE, True)
    para(value, 70, y+36, 455, 11)

def row(number, heading, body, y, height=94):
    box(52, y, 36, 36, WINE, 8); text(str(number).zfill(2), 60, y+8, 13, '#ffffff', True)
    text(heading, 104, y+1, 14, INK, True)
    para(body, 104, y+25, 439, 11, MUTED)
    return y+height

# 01 / Cover: an original typographic cover with a connected growth staircase.
box(0, 0, W, H, WINE)
text('SOFTORA.NL', 50, 42, 20, '#ffffff', True)
box(50, 108, 259, 25, '#a63d70', 12)
text('DE PRAKTISCHE GIDS VOOR ONDERNEMERS', 63, 115, 8, '#ffffff', True)
para('Meer groei.<br/>Minder<br/>handwerk.', 47, 165, 510, 58, '#ffffff', True, 62)
para('Ontdek hoe bedrijfssoftware<br/>je bedrijf helpt groeien.', 52, 379, 440, 20, '#f9dfea', leading=29)
for x, y, h, n, label, fill in [(52, 589, 117, '01', 'Overzicht', '#b7497b'), (216, 537, 169, '02', 'Slimmer werken', '#d78aaf'), (380, 481, 225, '03', 'Ruimte voor groei', LIME)]:
    box(x, y, 147, h, fill, 8)
    text(n, x+15, y+14, 11, INK, True)
    para(label, x+15, y+48, 117, 17, INK, True, 21)
    box(x+16, 676, 73, 4, INK, 2)
text('GROEISCAN  +  KEUZEHULP  +  30-DAGENPLAN', 52, 751, 10, '#ffffff', True)
text('Minder zoeken. Beter opvolgen. Meer gedaan krijgen.', 52, 774, 10, '#f9dfea')
c.showPage()

# 02 / The promise and a usable reading route.
page(2, 'Begin hier')
y = title('Je bedrijf groeit.<br/>Groeit je werkwijze mee?', 'Meer klanten is mooi. Maar als elke nieuwe opdracht extra zoekwerk, overdrachten en losse lijstjes oplevert, wordt groei al snel drukte.')
y = para('Bedrijfssoftware kan helpen om klantinformatie, planning, werk en facturatie met elkaar te verbinden. Zo hoeft je team minder te onthouden en minder over te typen. Dat maakt ruimte voor aandacht voor klanten en voor werk dat waarde toevoegt.', 52, y)+24
y = para('Het begint met één vraag: <b>welke terugkerende hobbel houdt ons vandaag het meest tegen?</b> In deze gids kies je die hobbel, bereken je wat verbetering waard kan zijn en maak je een eerste plan.', 52, y)+30
for n, heading, body in [('3-4', 'Vind je grootste groeirem', 'Doe de groeiscan en kies één proces om te verbeteren.'), ('5-8', 'Bepaal wat je nodig hebt', 'Verken CRM en automatisering, vergelijk oplossingen en reken ze door.'), ('9-11', 'Maak het concreet', 'Werk met een 30-dagenplan, leverancierscheck en invulbaar startcanvas.')]:
    text(n, 52, y, 16, WINE, True); text(heading, 110, y, 13, INK, True)
    para(body, 110, y+23, 433, 10.5, MUTED); y += 80
note('Je hoeft niet je hele bedrijf tegelijk te veranderen. Kies één proces waarvan je binnen een maand kunt zien of het beter werkt.', 667, 'DE GEDACHTE ACHTER DEZE GIDS')
c.showPage()

# 03 / Diagnostic worksheet.
page(3, '01 / Groeiscan')
y = title('Waar lekt jouw tijd weg?', 'Geef iedere uitspraak 0, 1 of 2 punten: 0 = bijna nooit, 1 = soms, 2 = vaak. Kijk naar de afgelopen twee weken.')
questions = ['We voeren dezelfde gegevens in meerdere systemen in.', 'Klantinformatie staat verspreid over inboxen en lijstjes.', 'Offertes of terugbelafspraken blijven te lang liggen.', 'We moeten collega’s vragen wat de status van werk is.', 'Planning hangt af van één persoon die alles weet.', 'Afgerond werk wordt pas dagen later gefactureerd.', 'We bouwen rapportages handmatig uit meerdere bestanden.', 'Nieuwe collega’s moeten veel ongeschreven stappen leren.']
for i, q in enumerate(questions):
    box(52, y, 491, 39, '#ffffff' if i % 2 == 0 else '#f3ecef', 3)
    para(q, 65, y+11, 383, 10)
    text('0   1   2', 465, y+12, 10, WINE, True); y += 43
text('TOTAAL: ____ / 16', 52, y+7, 12, WINE, True)
para('De score is een gesprekstarter, geen wetenschappelijke test. Ook één terugkerende fout kan genoeg reden zijn om een proces te verbeteren. Omcirkel je twee meest herkenbare uitspraken.', 52, y+38, size=10.5, color=MUTED)
note('Vraag twee collega’s om de scan ook te doen. Bespreek waar jullie antwoorden verschillen en verzamel één concreet voorbeeld.', 681, height=86)
c.showPage()

# 04 / A concrete process, including failure handling.
page(4, '02 / Kies je eerste proces')
y = title('Begin bij het werk.<br/>Daarna bij de software.', 'Een helder proces maakt een goede softwarekeuze mogelijk. Beschrijf wat er gebeurt, wie verantwoordelijk is en wanneer het werk klaar is.')
y = row(1, 'Kies één terugkerende route', 'Bijvoorbeeld: van een websiteaanvraag naar een opgevolgde offerte. Bepaal het begin en het einde; houd de eerste stap klein.', y, 87)
y = row(2, 'Teken de huidige stappen', 'Noteer per stap: wie doet het, waar staat de informatie en wat wordt overgetypt? Markeer wachten, zoeken en dubbel werk.', y, 87)
y = row(3, 'Spreek af wat beter moet', 'Kies één meetpunt, zoals minuten per aanvraag of het aantal offertes zonder volgende actie. Meet eerst hoe het nu gaat.', y, 87)
box(52, y+5, 491, 115, INK, 9)
text('VOORBEELD: VAN AANVRAAG NAAR ACTIE', 70, y+21, 9, '#e9bacf', True)
para('Aanvraag binnen  >  Eigenaar toegewezen  >  Volgende actie gepland  >  Uitkomst vastgelegd', 70, y+47, 452, 13, '#ffffff', True, 21)
note('Leg ook de uitzondering vast: wie krijgt een melding als een aanvraag niet aankomt of een koppeling uitvalt?', 674, 'VERGEET HET FOUTPAD NIET', 90)
c.showPage()

# 05 / CRM.
page(5, '03 / Meer grip op klanten')
y = title('Geen kans blijft<br/>zonder volgende stap.', 'Een CRM is een gezamenlijke plek voor klantinformatie, gesprekken en opvolging. De winst zit in de afspraken die je ermee uitvoert.')
for n, heading, body in [(1, 'Eén klantbeeld', 'Breng contactpersonen, offertes en relevante afspraken bij elkaar. Spreek af welke bron leidend is en voorkom meerdere versies van dezelfde klant.'), (2, 'Een eigenaar en een volgende actie', 'Iedere open aanvraag krijgt een verantwoordelijke en een datum. Een overzicht laat zien wat vandaag aandacht vraagt.'), (3, 'Opvolgen zonder te zoeken', 'Herinneringen helpen je team op tijd te reageren. Laat medewerkers zien waarom een taak bestaat en wat al met de klant is afgesproken.'), (4, 'Een overdracht die klopt', 'Als een offerte akkoord is, gaat de juiste informatie naar uitvoering. Denk aan scope, planning, contactpersoon en gemaakte afspraken.')]:
    y = row(n, heading, body, y, 101)
note('Begin met drie velden die echt helpen: eigenaar, volgende actie en actiedatum. Voeg pas iets toe als duidelijk is wie het gebruikt.', 686, height=80)
c.showPage()

# 06 / Automation, with control retained.
page(6, '04 / Minder terugkerend handwerk')
y = title('Laat systemen het<br/>herhaalwerk doen.', 'Automatiseer voorspelbare stappen. Houd ruimte voor een medewerker als een situatie afwijkt of een beslissing gevolgen heeft.')
items = [('Planning', 'Laat een akkoord voorstel een werkopdracht klaarzetten.', 'Een planner controleert capaciteit en bevestigt de datum.'), ('Documenten', 'Vul een conceptofferte met bestaande klantgegevens.', 'De verantwoordelijke controleert prijzen en afspraken.'), ('Facturatie', 'Zet een conceptfactuur klaar na goedgekeurd werk.', 'Een medewerker controleert meerwerk en verzendt.'), ('Klantvragen', 'Gebruik vaste antwoorden of AI om een concept te maken.', 'Laat afwijkende, gevoelige of onzekere vragen overnemen.')]
for heading, action, check in items:
    box(52, y, 491, 98, '#ffffff', 8)
    text(heading, 68, y+13, 14, WINE, True)
    para(action, 68, y+39, 455, 10.5)
    para('<b>Controle:</b> ' + check, 68, y+64, 455, 10, MUTED)
    y += 109
para('<b>Maak fouten zichtbaar.</b> Bewaar een log, voorkom dubbele acties en spreek af wie een mislukte stap herstelt. Een stille fout is duurder dan een duidelijke melding.', 52, y+5, size=11)
c.showPage()

# 07 / Software choice.
page(7, '05 / Standaard, koppelen of maatwerk')
y = title('Kies wat past.<br/>Ook als dat minder is.', 'Een bestaand pakket kan voldoende zijn. Soms is een koppeling de beste stap. Maatwerk wordt interessant als je kernproces aantoonbaar andere eisen stelt.')
choices = [('Standaardsoftware', 'Je proces is gangbaar en het pakket ondersteunt de belangrijke stappen.', 'Controleer: gebruikerskosten, inrichting, export en wat je team moet aanpassen.'), ('Bestaande tools koppelen', 'De losse systemen werken goed, maar informatie moet steeds worden overgetypt.', 'Controleer: beschikbare API’s, foutmeldingen, dubbele records en wie de koppeling beheert.'), ('Software op maat', 'Je onderscheidende proces past onvoldoende in bestaande oplossingen.', 'Controleer: afbakening, onderhoud, documentatie, toegang en eigendom van code en data.')]
for heading, body, check in choices:
    box(52, y, 491, 130, '#ffffff', 9)
    text(heading, 69, y+15, 16, WINE, True)
    para(body, 69, y+44, 452, 11)
    para(check, 69, y+86, 452, 10, MUTED)
    y += 142
para('<b>Laat elke optie hetzelfde voorbeeld oplossen.</b> Een mooie demonstratie zegt weinig als jouw lastigste overdracht buiten beeld blijft.', 52, y+3, size=11)
c.showPage()

# 08 / Honest business case.
page(8, '06 / Reken met je eigen cijfers')
y = title('Wat kan slimmer<br/>werken opleveren?', 'Maak je rekensom vóór je een offerte beoordeelt. Scheid vrijgekomen tijd van geld dat daadwerkelijk op je rekening blijft.')
box(52, y, 491, 187, INK, 9)
text('FICTIEF REKENVOORBEELD - GEEN RESULTAATBELOFTE', 70, y+17, 9, '#e9bacf', True)
text('8 uur minder handwerk per week', 70, y+49, 20, '#ffffff', True)
text('× 46 werkweken × € 40 interne uurwaarde', 70, y+80, 13, '#e9dce6')
text('€ 14.720', 70, y+111, 36, LIME, True)
text('jaarlijkse waarde van vrijgekomen capaciteit', 280, y+128, 10, '#ffffff')
y += 201
for label, value in [('Eenmalige inrichting (voorbeeld)', '€ 6.000'), ('Jaarlijks gebruik en onderhoud (voorbeeld)', '€ 4.800'), ('Totale kosten in jaar 1', '€ 10.800'), ('Capaciteitswaarde minus kosten in jaar 1', '€ 3.920')]:
    text(label, 52, y, 11); text(value, 459, y, 11, WINE, True); line(y+24); y += 31
y = para('Dit is geen voorspelling van extra winst. Tijd levert pas financieel voordeel op als je die benut voor betaald werk, overuren vermijdt of andere echte kosten verlaagt. Kosten zijn indicatief en exclusief btw; neem migratie, training, koppelingen en interne tijd apart mee.', 52, y+12, size=10.5, color=MUTED)+23
note('Reken ook met de helft van de tijdwinst: 4 uur per week geeft € 7.360 capaciteitswaarde. In dit voorbeeld is dat minder dan de kosten in jaar 1.', y, 'TEST OOK EEN VOORZICHTIG SCENARIO', 90)
c.showPage()

# 09 / Pilot.
page(9, '07 / Jouw eerste 30 dagen')
y = title('Van goed idee<br/>naar werkende verbetering.', 'Gebruik een kleine proef om aannames te testen. Bij een complex proces zijn 30 dagen een onderzoeks- en proefperiode, geen belofte dat alles dan live staat.')
for n, heading, body in [(1, 'Dag 1-7 / Kies en meet', 'Kies één proces, wijs een eigenaar aan en meet de beginsituatie. Verzamel echte voorbeelden en uitzonderingen. Formuleer een klein, toetsbaar doel.'), (2, 'Dag 8-14 / Ontwerp en probeer', 'Werk de gewenste stappen uit met de medewerkers die ermee gaan werken. Test een bestaande tool, koppeling of prototype met veilige testgegevens.'), (3, 'Dag 15-21 / Doe een beperkte proef', 'Laat een klein team echte scenario’s doorlopen. Controleer rechten, gegevens en foutafhandeling. Houd bij waar mensen vastlopen en verbeter die punten.'), (4, 'Dag 22-30 / Beslis met bewijs', 'Vergelijk met de beginsituatie. Werkt het beter en gebruikt het team het? Breid beheerst uit. Is het nog onzeker, verbeter eerst of stop de proef.')]:
    y = row(n, heading, body, y, 109)
note('Leg vooraf vast wanneer je doorgaat én wanneer je stopt. Bijvoorbeeld: geen verloren aanvragen, een eigenaar voor elke fout en aantoonbaar minder zoektijd.', 684, 'SPREEK DE BESLISREGEL VOORAF AF', 82)
c.showPage()

# 10 / Vendor checklist.
page(10, '08 / Checklist voor je softwaregesprek')
y = title('Stel deze vragen<br/>vóór je akkoord geeft.', 'Neem je procesvoorbeeld mee. Vraag om concrete antwoorden, een demonstratie en afspraken die je kunt teruglezen.')
checks = [('Proces', 'Welke stappen zijn inbegrepen? Wat valt erbuiten? Laat onze normale route én een uitzondering zien.'), ('Gegevens', 'Kunnen we onze gegevens exporteren? Wie controleert de migratie en wie beheert de toegang?'), ('Koppelingen', 'Wat gebeurt er bij een storing? Wie krijgt een melding, herstelt de fout en voorkomt dubbele acties?'), ('Kosten', 'Wat betalen we eenmalig en jaarlijks? Welke kosten groeien mee met gebruikers, volume, AI of wijzigingen?'), ('Oplevering', 'Wanneer is het werk geaccepteerd? Welke tests, handleiding en training horen erbij?'), ('Beheer en vertrek', 'Wie onderhoudt het systeem? Welke hulp krijgen we bij problemen en wat nemen we mee als we overstappen?')]
for heading, body in checks:
    box(53, y+4, 13, 13, PINK, 2); text(heading, 82, y, 13, WINE, True)
    para(body, 82, y+23, 460, 10.5, MUTED); y += 76
para('<b>Goede afspraak:</b> “We testen tien afgesproken scenario’s en leggen vast wie elke fout oplost.” Dat is beter te beoordelen dan alleen “het systeem werkt gebruiksvriendelijk”.', 52, y+6, size=11)
c.showPage()

# 11 / Printable worksheet.
page(11, '09 / Jouw startcanvas')
y = title('Maak het vandaag<br/>al concreet.', 'Vul deze pagina digitaal in of print hem. Pak de vragen samen met één collega op. Je hebt geen technische kennis nodig om te beginnen.')
fields = [('Het proces dat we willen verbeteren', 'Van welke start tot welk eindresultaat?'), ('Het probleem dat we nu zien', 'Noem één voorbeeld en hoeveel tijd of fouten dit oplevert.'), ('Ons meetbare doel', 'Wat moet verbeteren, voor wie en vóór welke datum?'), ('Onze eerste kleine proef', 'Wat testen we, met welk team en welke gegevens?'), ('Eigenaar, budget en beslismoment', 'Wie beslist? Wat mag de proef kosten? Wanneer evalueren we?')]
for heading, hint in fields:
    text(heading, 52, y, 12, INK, True); text(hint, 52, y+23, 9, MUTED)
    c.acroForm.textfield(name=heading, tooltip=heading + ': ' + hint, x=52, y=H-y-82,
        width=491, height=42, fontName='Helvetica', fontSize=11, fieldFlags='multiline',
        borderWidth=.5, borderColor=HexColor('#ddcfd6'), fillColor=HexColor('#ffffff'),
        textColor=HexColor(INK), forceBorder=True, maxlen=600)
    y += 101
c.showPage()

# 12 / Closing action, no fabricated claims.
page(12, 'Zet de volgende stap')
y = title('Laat je bedrijf groeien.<br/>Zonder dat alles op jou leunt.', 'De beste eerste stap is vaak verrassend klein: één duidelijk proces, één verantwoordelijke en één verbetering die je kunt meten.')
y = para('Bedrijfssoftware kan je helpen om klanten beter op te volgen, informatie vindbaar te maken en herhaalwerk te verminderen. De echte verandering ontstaat wanneer software en de dagelijkse werkwijze op elkaar aansluiten.', 52, y, size=12)+31
box(52, y, 491, 183, WINE, 10)
text('WIL JE SAMEN KIJKEN WAAR JE KUNT BEGINNEN?', 73, y+22, 9, '#f6d7e5', True)
para('Neem je startcanvas mee.<br/>Dan praten we over jouw werk.', 73, y+49, 449, 24, '#ffffff', True, 30)
text('Bekijk bedrijfssoftware van Softora', 73, y+133, 12, '#ffffff', True)
c.linkURL('https://www.softora.nl/bedrijfssoftware', (70, H-y-160, 468, H-y-128), relative=0)
y += 212
text('softora.nl/bedrijfssoftware', 52, y, 13, WINE, True)
text('Of vertel ons je vraag via softora.nl/contact', 52, y+30, 11, MUTED)
c.linkURL('https://www.softora.nl/contact', (50, H-y-47, 480, H-y-27), relative=0)
para('Deze gids is samengesteld door Softora, ontwikkelaar van bedrijfssoftware, websites en automatisering. De voorbeelden zijn ter illustratie. Wat passend is voor jouw bedrijf hangt af van je proces, gegevens, mensen en budget.', 52, 671, size=9.5, color=MUTED)
text('Editie oktober 2026  /  © Softora', 52, 743, 9, MUTED)
c.showPage()
c.save()
print(OUT / 'meer-groei-minder-handwerk.pdf')
