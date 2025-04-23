import { useState } from 'react';
import { getProjectStateManager } from '~/lib/projects';
import { createScopedLogger } from '~/utils/logger';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { useToast } from '~/components/ui/use-toast';
import type { ProjectFile, ProjectDeployment } from '~/lib/projects/types';
import type { 
  EnhancedProjectState, 
  EnhancedProjectFile, 
  EnhancedRequirementsEntry,
  EnhancedProjectDeployment 
} from '~/lib/projects/enhanced-types';
import type { ProjectState, RequirementsEntry } from '~/lib/projects/types';

const logger = createScopedLogger('storage-test');

// Convert ProjectFile to EnhancedProjectFile
function enhanceProjectFile(file: ProjectFile): EnhancedProjectFile {
  return {
    ...file,
    size: file.content?.length || 0,
    mimeType: 'text/plain',
    hash: '',
    version: 1
  };
}

// Convert RequirementsEntry to EnhancedRequirementsEntry
function enhanceRequirementsEntry(req: RequirementsEntry): EnhancedRequirementsEntry {
  return {
    ...req,
    status: 'pending',
    priority: 'medium'
  };
}

// Convert ProjectDeployment to EnhancedProjectDeployment
function enhanceDeployment(deployment: ProjectDeployment): EnhancedProjectDeployment {
  return {
    ...deployment,
    environment: 'production',
    branch: 'main'
  };
}

// Convert ProjectState to EnhancedProjectState
function enhanceProjectState(project: ProjectState): EnhancedProjectState {
  return {
    ...project,
    version: 1,
    status: 'active',
    searchIndex: {
      keywords: [],
      features: [],
      technologies: []
    },
    files: project.files?.map(enhanceProjectFile) || [],
    requirements: project.requirements?.map(enhanceRequirementsEntry) || [],
    deployments: project.deployments?.map(enhanceDeployment) || [],
    webhooks: project.webhooks || [],
    metadata: {
      ...project.metadata,
      version: project.metadata?.version || 1,
      type: project.metadata?.type || 'default',
      description: project.metadata?.description || '',
      tags: project.metadata?.tags || []
    }
  };
}

export function StorageTest() {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string>('');
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projectFiles, setProjectFiles] = useState<EnhancedProjectFile[]>([]);
  const [project, setProject] = useState<EnhancedProjectState | null>(null);
  const stateManager = getProjectStateManager();

  const handleCreateProject = async () => {
    try {
      const project = await stateManager.createProject({
        name: 'Test Project'
      });
      setProjectId(project.id);
      setProject(enhanceProjectState(project));
      toast('Created project with ID: ' + project.id, { type: 'success' });
    } catch (error) {
      console.error('Error creating project:', error);
      toast('Failed to create project', { type: 'error' });
    }
  };

  const handleGetProject = async () => {
    if (!projectId) {
      toast('Please enter a project ID', { type: 'error' });
      return;
    }

    try {
      const project = await stateManager.getProject(projectId);
      if (project) {
        setProject(enhanceProjectState(project));
        toast('Project retrieved successfully', { type: 'success' });
      } else {
        toast('Project not found', { type: 'error' });
      }
    } catch (error) {
      console.error('Error getting project:', error);
      toast('Failed to get project', { type: 'error' });
    }
  };

  const handleCacheFiles = async () => {
    if (!projectId || !filePath || !fileContent) {
      toast('Please enter project ID, file path, and content', { type: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      await stateManager.addFiles(projectId, {
        [filePath]: fileContent,
      });
      
      toast('Files cached successfully', { type: 'success' });
      
      // Reload the project files
      const files = await stateManager.getProjectFiles(projectId);
      setProjectFiles(files.map(enhanceProjectFile));
    } catch (error) {
      logger.error('Error caching files:', error);
      toast(error instanceof Error ? error.message : 'Unknown error', { type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleListProjects = async () => {
    try {
      const { projects, total } = await stateManager.listProjects();
      console.log('Projects:', projects);
      console.log('Total:', total);
      toast('Listed projects successfully', { type: 'success' });
    } catch (error) {
      console.error('Error listing projects:', error);
      toast('Failed to list projects', { type: 'error' });
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId) {
      toast('Please enter a project ID', { type: 'error' });
      return;
    }

    try {
      await stateManager.deleteProject(projectId);
      setProject(null);
      toast('Project deleted successfully', { type: 'success' });
    } catch (error) {
      console.error('Error deleting project:', error);
      toast('Failed to delete project', { type: 'error' });
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Storage Service Test</h2>
      
      <div className="space-y-2">
        <label className="block text-sm font-medium">Project ID</label>
        <Input
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Enter project ID"
        />
      </div>
      
      <Button onClick={handleGetProject} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Load Project'}
      </Button>

      {project && (
        <div className="mt-4 p-4 border rounded">
          <h3 className="font-semibold">Project Details</h3>
          <p>Name: {project.name}</p>
          <p>Created: {new Date(project.createdAt).toLocaleString()}</p>
          <p>Files: {projectFiles.length}</p>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">File Path</label>
        <Input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="Enter file path"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">File Content</label>
        <Input
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          placeholder="Enter file content"
        />
      </div>

      <Button onClick={handleCacheFiles} disabled={isLoading}>
        {isLoading ? 'Caching...' : 'Cache Files'}
      </Button>

      {projectFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">Project Files</h3>
          <ul className="mt-2 space-y-2">
            {projectFiles.map((file) => (
              <li key={file.path} className="p-2 border rounded">
                <p className="font-medium">{file.path}</p>
                <p className="text-sm text-gray-500">
                  Last updated: {new Date(file.updatedAt).toLocaleString()}
                </p>
                {file.isDeleted && (
                  <p className="text-sm text-red-500">Deleted</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
} 