export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ key: process.env.CLERK_PUBLISHABLE_KEY });
}
