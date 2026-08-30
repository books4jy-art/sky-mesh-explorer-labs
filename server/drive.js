// Replaces Base44's managed Google Drive connector with a plain Google Cloud
// service account. Share your Drive folders (read-only is enough) with the
// service account's client_email, then point GOOGLE_SERVICE_ACCOUNT_KEY_FILE
// (or GOOGLE_SERVICE_ACCOUNT_KEY, inline JSON) at its key.
import { GoogleAuth } from 'google-auth-library';

let authClient = null;

function buildAuth() {
  const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return new GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes });
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    return new GoogleAuth({ keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, scopes });
  }
  throw new Error(
    'Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path to a service-account JSON key) or GOOGLE_SERVICE_ACCOUNT_KEY (inline JSON).'
  );
}

export async function driveAuth() {
  if (!authClient) authClient = buildAuth();
  const client = await authClient.getClient();
  const { token } = await client.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}
