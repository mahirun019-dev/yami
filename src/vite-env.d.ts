/// <reference types="vite/client" />

declare const __YAMI_BUILD__: {
  commit: string | null;
  projectLicense: { filename: string; text: string } | null;
  dependencies: { name: string; version: string; license: string; text: string }[];
};
