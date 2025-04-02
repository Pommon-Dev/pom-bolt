# Environment System

The environment system provides a consistent interface for environment-specific operations across different deployment targets.

## Usage

### Basic Usage

The simplest way to use the environment system is through the helper functions in `environment-setup.ts`:

```typescript
import { getEnv, storeValue, retrieveValue, removeValue, generateUniqueId } from '~/lib/environment-setup';

// Access environment variables
const apiKey = getEnv('API_KEY');
const hasDebugMode = hasEnv('DEBUG_MODE');

// Store values
await storeValue('user-settings', { theme: 'dark', fontSize: 14 });

// Retrieve values
const settings = await retrieveValue('user-settings');

// Remove values
await removeValue('user-settings');

// Generate unique IDs
const id = generateUniqueId();
```

### Environment Information

To get information about the current environment:

```typescript
import { getEnvironmentInfo } from '~/lib/environment-setup';

const info = getEnvironmentInfo();
if (info.isProduction) {
  // Production-specific code
} else if (info.isDevelopment) {
  // Development-specific code
}
```

### Advanced Usage

For more advanced use cases, you can use the environment instance directly:

```typescript
import { environment, StorageType } from '~/lib/environments';

// Check available storage types
const availableStorageTypes = environment.getAvailableStorageTypes();

// Store a value in a specific storage type
await environment.storeValue(StorageType.LOCAL_STORAGE, 'key', value);
```

## Environment Implementations

### Local Environment

The `LocalEnvironment` class is used for local development and provides:
- File system access
- Command execution
- Memory and file-based storage
- Browser storage (when running in a browser)

### Cloudflare Environment

The `CloudflareEnvironment` class is used for Cloudflare Pages deployments and provides:
- Memory storage
- Browser storage (when running in a browser)
- KV storage (when KV binding is available)
- D1 database storage (when D1 binding is available)

## Testing

You can override the environment detection for testing:

```typescript
import { setEnvironment, LocalEnvironment } from '~/lib/environments';

// Set a mock environment
setEnvironment(new LocalEnvironment());

// Reset the environment after tests
import { resetEnvironment } from '~/lib/environments';
resetEnvironment();
```

## Environment Detection

The system automatically detects the current environment based on environment variables and other runtime conditions. You can manually specify the environment by passing appropriate parameters to the `getEnvironment` function.

## Components

The `EnvironmentIndicator` component can be used to display the current environment information, which is particularly useful during development and testing. 