// Re-export types and enums from base
export type { Environment, EnvironmentInfo } from './base';
export { EnvironmentType, StorageType } from './base';

// Re-export environment implementations
export { CloudflareEnvironment } from './cloudflare';
export { LocalEnvironment } from './local';

// Re-export environment detector functions
export { detectEnvironment, getEnvironment, resetEnvironment, setEnvironment } from './detector';

// Default export is the singleton environment accessor
import { getEnvironment } from './detector';
export default getEnvironment;
