import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestLike = IncomingMessage & { method?: string };
type ResponseLike = ServerResponse<IncomingMessage>;

export default function handler(_req: RequestLike, res: ResponseLike): void {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://twilio-media-bridge-pjzd.onrender.com/twilio-media" />
  </Connect>
</Response>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(twimlResponse);
}
