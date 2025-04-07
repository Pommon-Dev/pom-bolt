import { logDevReady } from "@remix-run/cloudflare";
import { createPagesFunctionHandler } from "@remix-run/cloudflare-pages";
import * as build from "@remix-run/dev/server-build";

// Add debug logs for bindings
if (process.env.NODE_ENV === "development") {
  logDevReady(build);
}

// Explicitly handle the environment bindings
export const onRequest = createPagesFunctionHandler({
  build,
  mode: process.env.NODE_ENV,
  getLoadContext: (context) => {
    // Debug logs
    console.log('Original context structure:', Object.keys(context));
    
    // Return context directly for maximum compatibility
    return context;
  },
}); 