import { google } from "googleapis";

// Local loopback is fine for a Desktop OAuth client.
export const REDIRECT_URI = "http://localhost:5555/oauth2callback";
export const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export function makeOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

// Authorized client for the running server (uses the stored refresh token).
export function authedClient() {
  const oauth2 = makeOAuthClient();
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing GOOGLE_REFRESH_TOKEN. Run `npm run auth` first.");
  }
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

// Download the raw .xlsx bytes of a Drive file (works for uploaded Excel files
// that you have at least view access to).
export async function downloadFileBytes(fileId) {
  const auth = authedClient();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}
