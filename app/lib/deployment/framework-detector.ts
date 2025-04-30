import { createScopedLogger } from '~/utils/logger';
import type { FrameworkDetectionResult, FrameworkType, PackageManagerType } from './types';
import { DeploymentErrorType } from './types';

const logger = createScopedLogger('framework-detector');

/**
 * Service to detect the framework and configuration of a project
 */
export class FrameworkDetector {
  /**
   * Detect the framework and build configuration from project files
   */
  public detect(files: Record<string, string>): FrameworkDetectionResult {
    logger.debug('Detecting framework from files', { fileCount: Object.keys(files).length });
    
    try {
      // First check package.json for Node.js projects
      if ('package.json' in files) {
        return this.detectFromPackageJson(files);
      }
      
      // Check for Python projects
      if ('requirements.txt' in files || 'pyproject.toml' in files) {
        return this.detectPythonFramework(files);
      }
      
      // Check for static sites (index.html)
      if ('index.html' in files) {
        return this.detectStaticSite(files);
      }
      
      // Default to unknown
      logger.info('No known framework detected, defaulting to static site');
      return {
        framework: 'static',
        buildCommand: '',
        outputDirectory: '/',
        packageManager: 'unknown',
        staticSite: true,
        hasBuildStep: false,
        dependencies: [],
        runtime: 'static'
      };
    } catch (error) {
      logger.error('Error detecting framework:', error);
      throw this.createError(
        DeploymentErrorType.FRAMEWORK_DETECTION_FAILED,
        'Failed to detect framework',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  
  /**
   * Detect framework from package.json for Node.js projects
   */
  private detectFromPackageJson(files: Record<string, string>): FrameworkDetectionResult {
    try {
      const packageJson = JSON.parse(files['package.json']);
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      // Convert dependencies object to array of names
      const dependencyList = Object.keys(dependencies || {});
      
      // Detect package manager
      const packageManager = this.detectPackageManager(files);
      
      // Check for specific frameworks
      if (dependencies.next) {
        logger.info('Detected Next.js framework');
        return {
          framework: 'next',
          buildCommand: 'npm run build',
          outputDirectory: packageJson.nextConfig?.output === 'export' ? 'out' : '.next',
          packageManager,
          staticSite: false,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.nuxt || dependencies['nuxt3']) {
        logger.info('Detected Nuxt.js framework');
        return {
          framework: 'nuxt',
          buildCommand: 'npm run build',
          outputDirectory: '.output',
          packageManager,
          staticSite: false,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.react) {
        // Check for common React frameworks
        if (dependencies['react-scripts'] || files['react-scripts.config.js']) {
          logger.info('Detected Create React App');
          return {
            framework: 'react',
            buildCommand: 'npm run build',
            outputDirectory: 'build',
            packageManager,
            staticSite: true,
            hasBuildStep: true,
            dependencies: dependencyList,
            runtime: 'node'
          };
        }
        
        if (dependencies.vite) {
          logger.info('Detected React with Vite');
          return {
            framework: 'react',
            buildCommand: 'npm run build',
            outputDirectory: 'dist',
            packageManager,
            staticSite: true,
            hasBuildStep: true,
            dependencies: dependencyList,
            runtime: 'node'
          };
        }
        
        logger.info('Detected React (generic)');
        return {
          framework: 'react',
          buildCommand: 'npm run build',
          outputDirectory: this.detectOutputDirFromPackageJson(packageJson) || 'build',
          packageManager,
          staticSite: true,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.vue) {
        logger.info('Detected Vue.js framework');
        return {
          framework: 'vue',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          packageManager,
          staticSite: true,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.svelte || dependencies['@sveltejs/kit']) {
        logger.info('Detected Svelte/SvelteKit framework');
        return {
          framework: 'svelte',
          buildCommand: 'npm run build',
          outputDirectory: 'build',
          packageManager,
          staticSite: true,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.express) {
        logger.info('Detected Express.js framework');
        return {
          framework: 'express',
          buildCommand: packageJson.scripts?.build || '',
          outputDirectory: './',
          packageManager,
          staticSite: false,
          hasBuildStep: !!packageJson.scripts?.build,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies.fastify) {
        logger.info('Detected Fastify framework');
        return {
          framework: 'fastify',
          buildCommand: packageJson.scripts?.build || '',
          outputDirectory: './',
          packageManager,
          staticSite: false,
          hasBuildStep: !!packageJson.scripts?.build,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      if (dependencies['@nestjs/core'] || dependencies.nest) {
        logger.info('Detected NestJS framework');
        return {
          framework: 'nest',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          packageManager,
          staticSite: false,
          hasBuildStep: true,
          dependencies: dependencyList,
          runtime: 'node'
        };
      }
      
      // Generic Node.js project
      logger.info('Detected generic Node.js project');
      return {
        framework: 'unknown',
        buildCommand: packageJson.scripts?.build || '',
        outputDirectory: this.detectOutputDirFromPackageJson(packageJson) || './',
        packageManager,
        staticSite: false,
        hasBuildStep: !!packageJson.scripts?.build,
        dependencies: dependencyList,
        runtime: 'node'
      };
      
    } catch (error) {
      logger.error('Error parsing package.json:', error);
      return {
        framework: 'unknown',
        buildCommand: '',
        outputDirectory: './',
        packageManager: 'npm',
        staticSite: false,
        hasBuildStep: false,
        dependencies: [],
        runtime: 'node'
      };
    }
  }
  
  /**
   * Detect Python framework from project files
   */
  private detectPythonFramework(files: Record<string, string>): FrameworkDetectionResult {
    let dependencies: string[] = [];
    
    // Check requirements.txt
    if ('requirements.txt' in files) {
      dependencies = files['requirements.txt']
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.split('==')[0] || line);
    }
    
    // Check for Flask
    if (
      dependencies.includes('flask') || 
      Object.keys(files).some(path => path.includes('flask')) ||
      Object.values(files).some(content => content.includes('from flask import'))
    ) {
      logger.info('Detected Flask framework');
      return {
        framework: 'flask',
        buildCommand: '',
        outputDirectory: './',
        packageManager: 'pip',
        staticSite: false,
        hasBuildStep: false,
        dependencies,
        runtime: 'python'
      };
    }
    
    // Check for Django
    if (
      dependencies.includes('django') || 
      'manage.py' in files ||
      Object.keys(files).some(path => path.includes('django')) ||
      Object.values(files).some(content => content.includes('from django import'))
    ) {
      logger.info('Detected Django framework');
      return {
        framework: 'django',
        buildCommand: 'python manage.py collectstatic --noinput',
        outputDirectory: 'staticfiles',
        packageManager: 'pip',
        staticSite: false,
        hasBuildStep: true,
        dependencies,
        runtime: 'python'
      };
    }
    
    // Check for FastAPI
    if (
      dependencies.includes('fastapi') || 
      Object.values(files).some(content => content.includes('from fastapi import'))
    ) {
      logger.info('Detected FastAPI framework');
      return {
        framework: 'fastapi',
        buildCommand: '',
        outputDirectory: './',
        packageManager: 'pip',
        staticSite: false,
        hasBuildStep: false,
        dependencies,
        runtime: 'python'
      };
    }
    
    // Generic Python project
    logger.info('Detected generic Python project');
    return {
      framework: 'unknown',
      buildCommand: '',
      outputDirectory: './',
      packageManager: 'pip',
      staticSite: false,
      hasBuildStep: false,
      dependencies,
      runtime: 'python'
    };
  }
  
  /**
   * Detect static site configuration
   */
  private detectStaticSite(files: Record<string, string>): FrameworkDetectionResult {
    logger.info('Detected static site');
    return {
      framework: 'static',
      buildCommand: '',
      outputDirectory: './',
      packageManager: 'unknown',
      staticSite: true,
      hasBuildStep: false,
      dependencies: [],
      runtime: 'static'
    };
  }
  
  /**
   * Detect package manager from lockfiles
   */
  private detectPackageManager(files: Record<string, string>): PackageManagerType {
    if ('yarn.lock' in files) {
      return 'yarn';
    }
    
    if ('pnpm-lock.yaml' in files) {
      return 'pnpm';
    }
    
    if ('package-lock.json' in files) {
      return 'npm';
    }
    
    return 'npm'; // Default to npm
  }
  
  /**
   * Try to detect output directory from package.json
   */
  private detectOutputDirFromPackageJson(packageJson: any): string | null {
    // Check for common build script patterns
    const buildScript = packageJson.scripts?.build || '';
    
    // Look for output directory flags in build script
    const outDirMatch = buildScript.match(/--out-dir[=\s]+["']?([^"'\s]+)["']?/);
    if (outDirMatch) {
      return outDirMatch[1];
    }
    
    // Check for common output directories
    if ('dist' in packageJson.scripts || buildScript.includes('dist')) {
      return 'dist';
    }
    
    if ('build' in packageJson.scripts || buildScript.includes('build')) {
      return 'build';
    }
    
    return null;
  }
  
  /**
   * Create a properly formatted error
   */
  private createError(type: DeploymentErrorType, message: string, originalError?: Error): Error {
    const error = new Error(message);
    error.name = type;
    
    if (originalError) {
      (error as any).originalError = originalError;
    }
    
    return error;
  }
} 