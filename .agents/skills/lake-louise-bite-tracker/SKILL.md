```markdown
# lake-louise-bite-tracker Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `lake-louise-bite-tracker` JavaScript codebase. You'll learn about file naming, import/export styles, commit message patterns, and how to work with tests. This guide is ideal for contributors seeking to maintain consistency and quality in this repository.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `biteTracker.js`, `userProfile.js`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```javascript
    import BiteTracker from './biteTracker';
    ```

### Export Style
- Use **default exports** for modules.
  - Example:
    ```javascript
    // biteTracker.js
    export default function BiteTracker() { ... }
    ```

### Commit Message Patterns
- Commit messages are **freeform** but often start with a prefix like `bitecast`.
- Average commit message length is about 62 characters.
  - Example:
    ```
    bitecast: add calorie counter to daily summary
    ```

## Workflows

### Adding a New Feature
**Trigger:** When you want to introduce a new functionality.
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Implement the feature, using default exports.
3. Import any dependencies using relative paths.
4. Write or update tests in a corresponding `*.test.*` file.
5. Commit your changes with a descriptive message, optionally prefixed (e.g., `bitecast:`).
6. Open a pull request for review.

### Fixing a Bug
**Trigger:** When you need to resolve a defect or issue.
**Command:** `/fix-bug`

1. Locate the relevant file(s) using camelCase naming.
2. Apply the bug fix, maintaining code style.
3. Update or add tests to cover the fix.
4. Commit with a clear message (e.g., `bitecast: fix off-by-one error in tracker`).
5. Open a pull request.

### Writing and Running Tests
**Trigger:** When adding new code or verifying functionality.
**Command:** `/run-tests`

1. Create or update files matching the `*.test.*` pattern.
2. Write tests for new or changed functionality.
3. Use the project's preferred test runner (framework not specified; check project docs or package.json).
4. Run the tests and ensure all pass before committing.

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `biteTracker.test.js`).
- The testing framework is not specified; check for further documentation or configuration files.
- Place tests alongside or near the modules they cover.
- Example test file:
  ```javascript
  // biteTracker.test.js
  import BiteTracker from './biteTracker';

  test('should track bites correctly', () => {
    const tracker = new BiteTracker();
    tracker.addBite(100);
    expect(tracker.getTotal()).toBe(100);
  });
  ```

## Commands
| Command      | Purpose                                      |
|--------------|----------------------------------------------|
| /add-feature | Start the workflow for adding a new feature  |
| /fix-bug     | Start the workflow for fixing a bug          |
| /run-tests   | Run all tests in the repository              |
```
