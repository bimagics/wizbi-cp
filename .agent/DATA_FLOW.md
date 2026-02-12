# Data Flow: How Values Get Into .env.example

## 📊 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. PROJECT CREATION REQUEST (src/routes/projects.ts)           │
│    POST /projects                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    User provides:
                    - orgId
                    - displayName: "ACME Web App"
                    - shortName: "webapp"
                    - template
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. PROJECT ID GENERATION (src/routes/projects.ts:196-197)      │
│    projectId = `wizbi-${orgSlug}-${formattedShortName}`        │
│    Result: "wizbi-acme-webapp"                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. PROVISIONING ORCHESTRATION (src/routes/projects.ts:108-111) │
│                                                                  │
│    const projectInfo = {                                        │
│        id: "wizbi-acme-webapp",          ← Generated ID         │
│        displayName: "ACME Web App",      ← From user input      │
│        gcpRegion: "europe-west1"         ← From env var         │
│    };                                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. GITHUB SERVICE CALL (src/routes/projects.ts:112)            │
│                                                                  │
│    GithubService.createGithubRepoFromTemplate(                  │
│        projectInfo,           ← The object with all values      │
│        teamSlug,                                                │
│        template                                                 │
│    )                                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. REPO CREATION (src/services/github.ts:129-160)              │
│                                                                  │
│    function createGithubRepoFromTemplate(                       │
│        project: ProjectData,  ← Receives the projectInfo object │
│        teamSlug,                                                │
│        templateRepo                                             │
│    )                                                            │
│                                                                  │
│    project = {                                                  │
│        id: "wizbi-acme-webapp",                                 │
│        displayName: "ACME Web App",                             │
│        gcpRegion: "europe-west1"                                │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. FILE CUSTOMIZATION LOOP (src/services/github.ts:158-161)    │
│                                                                  │
│    for (const branch of ['main', 'dev']) {                      │
│        for (const file of ['README.md',                         │
│                            'firebase.json',                     │
│                            '.env.example']) {                   │
│                                                                  │
│            await customizeFileContent(                          │
│                repo.name,                                       │
│                file,                                            │
│                project,    ← PASSES THE ENTIRE PROJECT OBJECT   │
│                branch                                           │
│            );                                                   │
│        }                                                        │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. PLACEHOLDER REPLACEMENT (src/services/github.ts:168-189)    │
│                                                                  │
│    async function customizeFileContent(                         │
│        repoName,                                                │
│        filePath,                                                │
│        replacements: Partial<ProjectData & {...}>,              │
│        branch                                                   │
│    ) {                                                          │
│        // Get file from GitHub                                  │
│        let content = Buffer.from(file.content, 'base64')        │
│                            .toString('utf8');                   │
│                                                                  │
│        // REPLACE PLACEHOLDERS WITH ACTUAL VALUES:              │
│        if (replacements.id)                                     │
│            content = content.replace(                           │
│                /\{\{PROJECT_ID\}\}/g,                           │
│                replacements.id  ← "wizbi-acme-webapp"           │
│            );                                                   │
│                                                                  │
│        if (replacements.displayName)                            │
│            content = content.replace(                           │
│                /\{\{PROJECT_DISPLAY_NAME\}\}/g,                 │
│                replacements.displayName  ← "ACME Web App"       │
│            );                                                   │
│                                                                  │
│        if (replacements.gcpRegion)                              │
│            content = content.replace(                           │
│                /\{\{GCP_REGION\}\}/g,                           │
│                replacements.gcpRegion  ← "europe-west1"         │
│            );                                                   │
│                                                                  │
│        // Update file in GitHub with new content                │
│        await client.repos.createOrUpdateFileContents({...});    │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. RESULT IN GITHUB REPOSITORY                                 │
│                                                                  │
│    Repository: bimagics/wizbi-acme-webapp                       │
│    Branch: main (and dev)                                       │
│    File: .env.example                                           │
│                                                                  │
│    BEFORE (in template):                                        │
│    ┌─────────────────────────────────┐                         │
│    │ GCP_PROJECT_ID={{PROJECT_ID}}  │                         │
│    │ GCP_REGION={{GCP_REGION}}      │                         │
│    └─────────────────────────────────┘                         │
│                                                                  │
│    AFTER (in new project):                                      │
│    ┌─────────────────────────────────────────┐                 │
│    │ GCP_PROJECT_ID=wizbi-acme-webapp       │                 │
│    │ GCP_REGION=europe-west1                │                 │
│    └─────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

## 🔍 Key Points

### Where the Values Come From:

1. **`id` (PROJECT_ID)**: 
   - Generated in `src/routes/projects.ts:197`
   - Formula: `wizbi-${orgSlug}-${formattedShortName}`
   - Example: `wizbi-acme-webapp`

2. **`displayName` (PROJECT_DISPLAY_NAME)**:
   - From user input in the admin panel
   - Passed directly from the POST request body
   - Example: `ACME Web Application`

3. **`gcpRegion` (GCP_REGION)**:
   - From environment variable `process.env.GCP_DEFAULT_REGION`
   - Fallback: `'europe-west1'`
   - Set in `src/routes/projects.ts:110`

### The Object Being Passed:

```typescript
// Interface definition (src/services/github.ts:19-23)
interface ProjectData {
    id: string;           // "wizbi-acme-webapp"
    displayName: string;  // "ACME Web App"
    gcpRegion: string;    // "europe-west1"
}

// Actual object created (src/routes/projects.ts:108-111)
const projectInfo = {
    id: projectId,                                    // Generated
    displayName: displayName,                         // User input
    gcpRegion: process.env.GCP_DEFAULT_REGION || 'europe-west1'  // Env var
};

// Passed to GitHub service (src/routes/projects.ts:112)
GithubService.createGithubRepoFromTemplate(projectInfo, ...);

// Received by function (src/services/github.ts:129)
export async function createGithubRepoFromTemplate(
    project: ProjectData,  // ← This is the projectInfo object
    ...
)

// Passed to customization (src/services/github.ts:160)
await customizeFileContent(repo.name, file, project, branch);
                                              ↑
                                    This contains all the values
```

## 📝 Example Walkthrough

### Input:
```json
{
  "orgId": "org-acme",
  "displayName": "ACME Web Application",
  "shortName": "webapp",
  "template": "template-nextjs"
}
```

### Processing:
1. Organization slug: `acme` (from org name)
2. Project ID generated: `wizbi-acme-webapp`
3. GCP Region from env: `europe-west1`

### Object Passed Through System:
```typescript
{
  id: "wizbi-acme-webapp",
  displayName: "ACME Web Application",
  gcpRegion: "europe-west1"
}
```

### Template `.env.example`:
```env
GCP_PROJECT_ID={{PROJECT_ID}}
GCP_REGION={{GCP_REGION}}
PROJECT_NAME={{PROJECT_DISPLAY_NAME}}
```

### Final `.env.example` in New Repo:
```env
GCP_PROJECT_ID=wizbi-acme-webapp
GCP_REGION=europe-west1
PROJECT_NAME=ACME Web Application
```

## 🎯 Summary

The values are inserted via the **`project` parameter** passed to `customizeFileContent()`:

- **Line 160** in `github.ts`: `await customizeFileContent(repo.name, file, project, branch);`
- The `project` object contains `id`, `displayName`, and `gcpRegion`
- These are used in **lines 184-186** to replace the placeholders
- The replacement happens using regex: `/\{\{PLACEHOLDER\}\}/g`
- The updated content is committed back to GitHub
