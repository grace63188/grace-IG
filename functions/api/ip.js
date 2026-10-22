/* Cloudflare Pages Function：GET /api/ip → {"ip":"1.2.3.4"}
   給前台（grace-IG）取訪客 IP 用；只允許前台與本站來源。IP 本身不在此處保存。 */
const ALLOW = ['https://grace63188.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
export async function onRequestGet({ request }) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOW.includes(origin) || /^https:\/\/([a-z0-9-]+\.)?grace-hub-d8l\.pages\.dev$/.test(origin) ? origin : ALLOW[0];
  const ip = request.headers.get('CF-Connecting-IP') || '';
  return new Response(JSON.stringify({ ip }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin' } });
}
export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0], 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } });
}
