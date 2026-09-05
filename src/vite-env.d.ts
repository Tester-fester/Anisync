/// <reference types="vite/client" />

// Declare client-side env vars (must be prefixed with VITE_ to be exposed to
// the browser by Vite). See src/utils/firebase.ts for usage.
interface ImportMetaEnv {
  readonly VITE_FIRESTORE_DATABASE_ID?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.png" {
  const content: string;
  export default content;
}

declare module "*.jpg" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default content;
}
