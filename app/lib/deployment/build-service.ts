import { createScopedLogger } from '~/utils/logger';
import { FrameworkDetector } from './framework-detector';
import type { BuildResult, FrameworkDetectionResult } from './types';
import { DeploymentErrorType } from './types';
import { getEnvironment } from '~/lib/environments';

const logger = createScopedLogger('build-service');

/**
 * Service to build projects for deployment
 */
export class BuildService {
  private frameworkDetector: FrameworkDetector;
  
  constructor() {
    this.frameworkDetector = new FrameworkDetector();
  }
  
  /**
   * Build a project for deployment
   * @param files The project files
   * @returns The build result with output files
   */
  public async build(files: Record<string, string>): Promise<BuildResult> {
    try {
      logger.info('Starting build process', { fileCount: Object.keys(files).length });
      
      // Detect the framework
      const frameworkInfo = this.frameworkDetector.detect(files);
      logger.info('Framework detected', { 
        framework: frameworkInfo.framework,
        buildCommand: frameworkInfo.buildCommand,
        outputDirectory: frameworkInfo.outputDirectory,
        packageManager: frameworkInfo.packageManager,
        staticSite: frameworkInfo.staticSite,
        hasBuildStep: frameworkInfo.hasBuildStep
      });
      
      // If it's a static site with no build step, return the files as-is
      if (frameworkInfo.staticSite && !frameworkInfo.hasBuildStep) {
        logger.info('Static site with no build step, returning files as-is');
        return {
          success: true,
          outputFiles: files,
          logs: ['Static site detected, no build required'],
          frameworkInfo
        };
      }
      
      // For sites that require building, we need to handle this specially
      if (frameworkInfo.hasBuildStep) {
        return this.buildProject(files, frameworkInfo);
      }
      
      // For other cases, return the files as-is
      logger.info('No build step required, returning files as-is');
      return {
        success: true,
        outputFiles: files,
        logs: ['No build step required'],
        frameworkInfo
      };
    } catch (error) {
      logger.error('Error during build process:', error);
      throw this.createError(
        DeploymentErrorType.BUILD_FAILED,
        'Failed to build project',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  
  /**
   * Build a project using the appropriate method based on the environment
   */
  private async buildProject(
    files: Record<string, string>, 
    frameworkInfo: FrameworkDetectionResult
  ): Promise<BuildResult> {
    const environment = getEnvironment();
    const envInfo = environment.getInfo();
    
    // For now, we'll simulate the build process
    // In a real implementation, this would use Docker, WebContainers, or other techniques
    logger.info('Simulating build process', { 
      environment: envInfo.type,
      framework: frameworkInfo.framework
    });
    
    // For most common frameworks, we can determine output files without actual building
    switch (frameworkInfo.framework) {
      case 'react':
        return this.simulateReactBuild(files, frameworkInfo);
      case 'vue':
        return this.simulateVueBuild(files, frameworkInfo);
      case 'static':
        return {
          success: true,
          outputFiles: files,
          logs: ['Static site - using files as-is'],
          frameworkInfo
        };
      default:
        // For other frameworks, we'll just use the original files for now
        // In a real implementation, we would perform an actual build
        logger.warn(`Build simulation not implemented for ${frameworkInfo.framework}, using original files`);
        return {
          success: true,
          outputFiles: files,
          logs: [`Build simulation not implemented for ${frameworkInfo.framework}`],
          frameworkInfo
        };
    }
  }
  
  /**
   * Simulate a React build process
   * This is a simplified simulation - in a real implementation we would actually run the build command
   */
  private simulateReactBuild(
    files: Record<string, string>,
    frameworkInfo: FrameworkDetectionResult
  ): BuildResult {
    logger.info('Simulating React build');
    
    const outputFiles: Record<string, string> = {};
    
    // Create a simple index.html if it doesn't exist
    if (!files['public/index.html'] && !files['index.html']) {
      outputFiles['index.html'] = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React App</title>
  <script defer src="main.js"></script>
  <link rel="stylesheet" href="main.css">
</head>
<body>
  <div id="root"></div>
</body>
</html>
      `.trim();
    } else {
      // Copy the existing index.html
      const indexPath = files['public/index.html'] ? 'public/index.html' : 'index.html';
      outputFiles['index.html'] = files[indexPath];
    }
    
    // Create a placeholder main.js file that would be the bundled output
    outputFiles['main.js'] = '// Bundled JavaScript would be here';
    
    // Create a placeholder CSS file
    outputFiles['main.css'] = '/* Bundled CSS would be here */';
    
    // Add any static assets from the public directory
    Object.entries(files).forEach(([path, content]) => {
      if (path.startsWith('public/') && path !== 'public/index.html') {
        const newPath = path.replace('public/', '');
        outputFiles[newPath] = content;
      }
    });
    
    return {
      success: true,
      outputFiles,
      logs: ['Simulated React build completed'],
      frameworkInfo
    };
  }
  
  /**
   * Simulate a Vue build process
   * This is a simplified simulation - in a real implementation we would actually run the build command
   */
  private simulateVueBuild(
    files: Record<string, string>,
    frameworkInfo: FrameworkDetectionResult
  ): BuildResult {
    logger.info('Simulating Vue build');
    
    const outputFiles: Record<string, string> = {};
    
    // Create a simple index.html
    outputFiles['index.html'] = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vue App</title>
  <script defer src="main.js"></script>
  <link rel="stylesheet" href="main.css">
</head>
<body>
  <div id="app"></div>
</body>
</html>
    `.trim();
    
    // Create a placeholder main.js file that would be the bundled output
    outputFiles['main.js'] = '// Bundled JavaScript would be here';
    
    // Create a placeholder CSS file
    outputFiles['main.css'] = '/* Bundled CSS would be here */';
    
    // Add any static assets from the public directory
    Object.entries(files).forEach(([path, content]) => {
      if (path.startsWith('public/')) {
        const newPath = path.replace('public/', '');
        outputFiles[newPath] = content;
      }
    });
    
    return {
      success: true,
      outputFiles,
      logs: ['Simulated Vue build completed'],
      frameworkInfo
    };
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