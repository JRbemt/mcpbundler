# Contributing to MCPbundler

First of all, thank you for wanting to contribute to this project! Without your
input, this will never become a better open source project.

## How can you contribute?

There are several ways to contribute to this project:

### Report a bug

Have you found a bug? Please create an [issue]({{ issueLink }}) with:

- A clear and descriptive title  
- Steps to reproduce the bug  
- Expected behavior vs. actual behavior  
- Screenshots or error messages (if applicable)  
- Your environment (OS, browser version, etc.)

### Propose features

Do you have an idea for a new feature? Open an issue with:

- A clear description of the feature  
- Why this feature would be valuable  
- Any examples or mockups

### Improve documentation

Documentation can always be improved! Pull requests for documentation
improvements are very welcome.

### Contribute code

Would you like to contribute code? Please follow the process below.

## Development process

### 1. Fork and clone the repository

```bash
git clone {{ url }}
cd directory-name
```

### 2. Fork and clone the repository

For a feature:
```bash
git checkout -b feature/new-feature
```

Or for a bugfix:

```bash
git checkout -b fix/issue-number-short-description
```

### 3. Install dependencies
```
npm i
```

### 4. Make changes
* Write clear, readable code
* Add tests for new functionality
* Update documentation where needed

### 5. Test your changes
npm test

### 6. Commit Changes
We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:

- `feat`: A new feature
- `fix`: Een bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or modifying tests
- `chore`: Maintenance (dependencies, etc.)

Example:

```
feat(auth): add two-factor authenticatie

Implements TOTP-based 2FA for users.

Closes #123
```

### 7. Push to your fork 
``` bash
git push origin feature/my-new-feature
```

### 8. Open a Pull Request

* Give your PR a clear title and description
* Link related issues
* Make sure all tests pass
* Wait for review by a maintainer