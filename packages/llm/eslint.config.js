import base from "@app/eslint-config/base";

export default [
  ...base,
  // The one package that talks to model vendors' SDKs.
  { rules: { "no-restricted-imports": "off" } },
];
