#!/usr/bin/env node
/**
 * Version synchronization script for ioBroker adapters
 * Keeps package.json and io-package.json in sync
 *
 * Usage:
 *   node scripts/version.js patch|minor|major
 *   node scripts/version.js 1.2.3
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const ioPackageJsonPath = path.join(rootDir, 'io-package.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n');
}

function bumpVersion(currentVersion, type) {
    const parts = currentVersion.split('.').map(Number);

    switch (type) {
        case 'major':
            parts[0]++;
            parts[1] = 0;
            parts[2] = 0;
            break;
        case 'minor':
            parts[1]++;
            parts[2] = 0;
            break;
        case 'patch':
            parts[2]++;
            break;
        default:
            // Assume it's a specific version number
            if (/^\d+\.\d+\.\d+$/.test(type)) {
                return type;
            }
            throw new Error(`Invalid version type: ${type}`);
    }

    return parts.join('.');
}

function main() {
    const versionType = process.argv[2];

    if (!versionType) {
        console.log('Usage: node scripts/version.js patch|minor|major|x.y.z');
        console.log('');
        console.log('Examples:');
        console.log('  node scripts/version.js patch   # 1.0.0 -> 1.0.1');
        console.log('  node scripts/version.js minor   # 1.0.0 -> 1.1.0');
        console.log('  node scripts/version.js major   # 1.0.0 -> 2.0.0');
        console.log('  node scripts/version.js 2.0.0   # Set specific version');
        process.exit(1);
    }

    // Read current versions
    const packageJson = readJson(packageJsonPath);
    const ioPackageJson = readJson(ioPackageJsonPath);

    const currentVersion = packageJson.version;
    const newVersion = bumpVersion(currentVersion, versionType);

    console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

    // Update package.json
    packageJson.version = newVersion;
    writeJson(packageJsonPath, packageJson);
    console.log('Updated package.json');

    // Update io-package.json
    ioPackageJson.common.version = newVersion;
    writeJson(ioPackageJsonPath, ioPackageJson);
    console.log('Updated io-package.json');

    // Git operations
    try {
        execSync('git add package.json io-package.json', { cwd: rootDir, stdio: 'inherit' });
        execSync(`git commit -m "chore: bump version to ${newVersion}"`, { cwd: rootDir, stdio: 'inherit' });
        execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { cwd: rootDir, stdio: 'inherit' });
        console.log(`\nCreated git tag: v${newVersion}`);
        console.log('\nTo push the release:');
        console.log(`  git push && git push origin v${newVersion}`);
    } catch (error) {
        console.error('Git operations failed:', error.message);
        console.log('\nVersion files updated. Please commit and tag manually.');
    }
}

main();
