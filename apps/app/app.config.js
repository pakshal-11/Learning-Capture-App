// Adds the pieces that depend on files/secrets that are not in git, then hands back app.json's config.
//   google-services.json  (Firebase, for Android push notifications; see docs/APP.md)
//   EAS_PROJECT_ID        (Expo project id; needed by the Expo push token request)
const fs = require("node:fs");
const path = require("node:path");

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, "google-services.json");
  return {
    ...config,
    android: {
      ...config.android,
      ...(fs.existsSync(googleServices) ? { googleServicesFile: "./google-services.json" } : {}),
    },
    extra: {
      ...config.extra,
      ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
  };
};
