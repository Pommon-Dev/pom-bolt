# Pommon-bolt Onboarding Guide

## Project Overview
Pom-bolt is an AI-powered development environment built on modern web technologies. It provides an integrated development environment (IDE) with AI capabilities, code editing, and project management features. The system supports multiple input methods for AI interaction, including direct chat and structured file input.

## Quick Start

### Prerequisites
- Node.js >= 18.18.0
- pnpm (package manager)
- Docker (optional, for containerized development)
- Git

### Development Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up environment variables:
   - Copy `.env.example` to `.env.local`
   - Configure required API keys for AI providers
4. Start development server:
   ```bash
   pnpm run dev
   ```

### Docker Development
1. Build development container:
   ```bash
   pnpm run dockerbuild
   ```
2. Run development container:
   ```bash
   pnpm run dockerrun
   ```

## Project Structure

### Core Directories
- `/app` - Main application code
  - `/components` - React components
  - `/routes` - Remix routes and API endpoints
  - `/lib` - Core utilities and services
  - `/styles` - Global styles and CSS
  - `/types` - TypeScript type definitions
- `/docs` - Project documentation
- `/public` - Static assets
- `/scripts` - Build and utility scripts

### Key Files
- `package.json` - Project dependencies and scripts
- `vite.config.ts` - Vite build configuration
- `docker-compose.yaml` - Docker services configuration
- `netlify.toml` - Netlify deployment configuration
- `wrangler.toml` - Cloudflare Pages configuration

## Technology Stack

### Frontend
- **Framework**: Remix.js with React
- **Build System**: Vite
- **Styling**: UnoCSS + Tailwind
- **State Management**: Zustand + Nanostores
- **Code Editor**: CodeMirror
- **Terminal**: xterm.js
- **Container**: WebContainer API

### Backend & Infrastructure
- **Cloud Platform**: Cloudflare Pages
- **AI Integration**: Multiple providers (OpenAI, Anthropic, Google, etc.)
- **Deployment**: Docker, Cloudflare Pages, Netlify
- **Streaming**: Server-Sent Events (SSE)

## Core Features

### 1. AI Integration
- Multiple AI provider support
- Chat interface
- File-based input processing
- Model management
- Response streaming

### 2. Development Environment
- Browser-based IDE
- Code editing with syntax highlighting
- Terminal integration
- Git operations
- File management

### 3. Project Management
- Project navigation
- File tree
- Project settings
- Requirements management

### 4. Deployment
- Project deployment
- Preview generation
- Environment management
- Build process automation

## Development Workflow

### Code Organization
- Components are organized by feature
- Routes follow Remix.js conventions
- Shared utilities in `/lib`
- Type definitions in `/types`

### State Management
- Zustand for global state
- Nanostores for reactive state
- Component-level state with React hooks

### Testing
- Vitest for unit testing
- React Testing Library for component testing
- Run tests with `pnpm test`

### Code Quality
- ESLint for code linting
- Prettier for code formatting
- TypeScript for type safety
- Husky for git hooks

## Deployment

### Production Deployment
1. Build the application:
   ```bash
   pnpm run build
   ```
2. Deploy to Cloudflare Pages:
   ```bash
   pnpm run deploy
   ```

### Docker Deployment
1. Build production container:
   ```bash
   pnpm run dockerbuild:prod
   ```
2. Run production container:
   ```bash
   docker run -it -d --name bolt-ai-live -p 5173:5173 --env-file .env.local bolt-ai
   ```

#### Netlify Deployment
- **Configuration**: Uses `netlify.toml`
- **Build Command**: `pnpm run build`
- **Publish Directory**: `build/client`
- **Serverless Functions**: Netlify Functions for API endpoints

## Requirements API and Webhook System

#### Overview
The project includes a robust requirements handling system that supports:
- File uploads
- Webhook integration
- Real-time processing
- Project-specific requirements

#### Key Components

1. **Requirements API Endpoint** (`/api/requirements`)
   - Handles POST and GET requests
   - Supports both JSON and form data
   - Manages requirements state
   - Provides webhook functionality

2. **File Processing** (`/api/file-input`)
   - Processes uploaded files
   - Extracts requirements
   - Generates structured messages
   - Creates initial project structure

3. **Webhook Integration**
   - Polls for new requirements every 3 seconds
   - Supports project-specific requirements
   - Handles redirects and state management
   - Provides real-time feedback

#### Production Considerations

1. **State Management**
   - Currently uses in-memory storage
   - Consider implementing persistent storage (database) for production
   - Options:
     - Cloudflare D1 (SQLite)
     - PostgreSQL
     - MongoDB

2. **Security**
   - Implement webhook authentication
   - Add rate limiting
   - Validate file uploads
   - Secure API endpoints

3. **Scalability**
   - Use distributed storage for requirements
   - Implement caching
   - Consider queue system for processing
   - Monitor resource usage

4. **Monitoring**
   - Add logging for webhook events
   - Track processing times
   - Monitor error rates
   - Set up alerts

### Production Environment Setup

1. **Environment Variables**
   ```bash
   # Required
   OPENAI_API_KEY=your_key
   ANTHROPIC_API_KEY=your_key
   GOOGLE_GENERATIVE_AI_API_KEY=your_key
   
   # Optional
   VITE_LOG_LEVEL=info
   DEFAULT_NUM_CTX=32768
   OLLAMA_API_BASE_URL=your_url
   ```

2. **Database Setup** (if implementing persistent storage)
   ```bash
   # Example with PostgreSQL
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   ```

3. **Monitoring Setup**
   ```bash
   # Example with Cloudflare Analytics
   ENABLE_ANALYTICS=true
   LOG_LEVEL=info
   ```

4. **Security Configuration**
   ```bash
   # Webhook security
   WEBHOOK_SECRET=your_secret
   RATE_LIMIT=100
   MAX_FILE_SIZE=10485760
   ```

### Deployment Checklist

1. **Pre-deployment**
   - [ ] Update environment variables
   - [ ] Configure monitoring
   - [ ] Set up logging
   - [ ] Test webhook integration
   - [ ] Verify file processing
   - [ ] Check security settings

2. **Deployment**
   - [ ] Build application
   - [ ] Deploy to chosen platform
   - [ ] Verify endpoints
   - [ ] Test webhook functionality
   - [ ] Monitor logs
   - [ ] Check performance

3. **Post-deployment**
   - [ ] Monitor error rates
   - [ ] Check resource usage
   - [ ] Verify analytics
   - [ ] Test backup systems
   - [ ] Document deployment

### Scaling Considerations

1. **Horizontal Scaling**
   - Use container orchestration (Kubernetes)
   - Implement load balancing
   - Configure auto-scaling

2. **Vertical Scaling**
   - Monitor resource usage
   - Upgrade instance sizes
   - Optimize database queries

3. **Performance Optimization**
   - Implement caching
   - Use CDN for static assets
   - Optimize database indexes
   - Monitor response times

4. **Cost Optimization**
   - Use spot instances where possible
   - Implement resource limits
   - Monitor usage patterns
   - Set up cost alerts

## Environment Variables

### Required Variables
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GOOGLE_GENERATIVE_AI_API_KEY` - Google AI API key
- Additional AI provider keys as needed

### Optional Variables
- `VITE_LOG_LEVEL` - Logging level (default: debug)
- `DEFAULT_NUM_CTX` - Default context size (default: 32768)
- `OLLAMA_API_BASE_URL` - Ollama API URL

## Common Tasks

### Adding New Features
1. Create new route in `/app/routes`
2. Add components in `/app/components`
3. Update types in `/app/types`
4. Add tests in `/app/__tests__`
5. Update documentation

### Debugging
1. Check browser console for errors
2. Use `VITE_LOG_LEVEL=debug` for detailed logs
3. Check Cloudflare Pages logs for deployment issues
4. Use Docker logs for container issues

### Performance Optimization
1. Use React DevTools for component profiling
2. Monitor bundle size with `pnpm run build`
3. Check Lighthouse scores
4. Monitor Cloudflare analytics

## Best Practices

### Code Style
- Follow TypeScript best practices
- Use functional components with hooks
- Implement proper error handling
- Write comprehensive tests
- Document complex logic

### Performance
- Implement code splitting
- Use proper caching strategies
- Optimize bundle size
- Monitor performance metrics

### Security
- Never commit API keys
- Validate user input
- Implement proper authentication
- Follow security best practices

## Getting Help
- Check existing documentation
- Review GitHub issues
- Ask team members
- Contact project maintainers

## Next Steps
1. Set up development environment
2. Review existing codebase
3. Understand core features
4. Start with small tasks
5. Contribute to documentation
6. Participate in code reviews
7. Take ownership of features

## Resources
- [Remix.js Documentation](https://remix.run/docs)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Docker Documentation](https://docs.docker.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)