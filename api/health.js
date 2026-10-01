const { buildHealthPayload } = require("./_health");

module.exports = async function handler(req, res) {
  const payload = await buildHealthPayload();

  res.writeHead(payload.ok ? 200 : 500, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify(payload));
};
