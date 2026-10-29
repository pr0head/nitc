// Where the Android app lives, and whether we already run inside it.
const RELEASES = 'https://github.com/pr0head/nitc/releases';
// the latest APK ships with the site, so it downloads from whichever mirror
// the map came from (GitHub may be unreachable where the map is not)
export const APK_URL = `${import.meta.env.BASE_URL}nitc.apk`;
// one release's notes (and its APK)
export const releaseUrl = (v) => `${RELEASES}/tag/v${v}`;
// the Android shell appends this to its user agent
const shell = navigator.userAgent.match(/NITC-Android\/(\S+)/);
export const inAndroidApp = !!shell;
// the shell's own version: it changes only when the APK is rebuilt
export const androidAppVersion = shell ? shell[1] : '';
// a browser on an Android phone: the app would serve it better
export const androidBrowser = !inAndroidApp && /Android/i.test(navigator.userAgent);

// The newest shell, as the release had it when the site was built (CI sets
// VITE_APK_VERSION); empty in dev or if CI could not tell.
const latestApk = import.meta.env.VITE_APK_VERSION || '';
const parts = (v) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
function newer(a, b) {
  const x = parts(a), y = parts(b);
  if (!x || !y) return false; // e.g. a "dev" shell: nothing to compare
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}
// the version to update the app to, or '' when it is current
export const appUpdate = inAndroidApp && newer(latestApk, androidAppVersion) ? latestApk : '';
// The shell keeps https links to the map inside itself and cannot download
// files; an http link leaves for the browser, which the mirror redirects to
// https and which downloads the APK.
export const updateUrl = `http://${location.host}${import.meta.env.BASE_URL}nitc.apk?v=${latestApk}`;
