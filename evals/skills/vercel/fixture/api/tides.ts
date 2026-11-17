// Serverless function: the tide data provider key is read from the environment.
export default function handler(_req: unknown, res: { json: (v: unknown) => void; status: (n: number) => { json: (v: unknown) => void } }) {
  const key = process.env.TIDE_API_KEY;
  if (!key) return res.status(500).json({ error: 'TIDE_API_KEY is not set' });
  return res.json({ nextHigh: '14:05' });
}
