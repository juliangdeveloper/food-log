import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[data-src="${src}"]`);
    if (found?.dataset.loaded === "1") {
      resolve();
      return;
    }
    const script = found || document.createElement("script");
    const timer = setTimeout(() => reject(new Error("timeout")), 15000);
    script.dataset.src = src;
    script.src = src;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("script"));
    };
    if (!found) document.head.appendChild(script);
  });
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    const google = globalThis.google;
    if (!google?.accounts?.oauth2) {
      reject(new Error("auth"));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response?.access_token) resolve(response.access_token);
        else reject(new Error(response?.error || "auth"));
      },
      error_callback: (err) => reject(err || new Error("auth")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function openPicker(token) {
  return new Promise((resolve, reject) => {
    const google = globalThis.google;
    if (!google?.picker) {
      reject(new Error("picker"));
      return;
    }
    const viewId = google.picker.ViewId.SPREADSHEETS || google.picker.ViewId.DOCS;
    const view = new google.picker.DocsView(viewId);
    if (google.picker.ViewId.SPREADSHEETS && view.setMimeTypes) {
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");
    }
    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setTitle("Tabla de nutrición")
      .setLocale("es")
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]?.id) {
          resolve(data.docs[0].id);
          return;
        }
        if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (GOOGLE_API_KEY) builder.setDeveloperKey(GOOGLE_API_KEY);
    builder.build().setVisible(true);
  });
}

export async function pickSpreadsheet() {
  if (!GOOGLE_CLIENT_ID) throw new Error("no_client");
  await loadScript("https://accounts.google.com/gsi/client");
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((resolve, reject) => {
    const gapi = globalThis.gapi;
    if (!gapi?.load) {
      reject(new Error("picker"));
      return;
    }
    gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("picker")) });
  });
  const token = await requestAccessToken();
  return openPicker(token);
}
