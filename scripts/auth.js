import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { makeOAuthClient, SCOPES } from "../src/google.js";

const oauth2 = makeOAuthClient();
const url = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh_token every time
  scope: SCOPES,
});

console.log("\n1) Open this URL in your browser and sign in with the Google account");
console.log("   that has access to the rota:\n");
console.log("   " + url + "\n");
console.log("2) Approve access. You'll be redirected to a localhost page.\n");

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, "http://localhost:5555").searchParams.get("code");
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Done. You can close this tab and return to the terminal.</h2>");
    console.log("\n✅ Success. Add this line to your .env file:\n");
    console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
  } catch (e) {
    res.writeHead(500).end("Auth failed: " + e.message);
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(5555, () => console.log("Waiting for Google redirect on http://localhost:5555 ...\n"));
