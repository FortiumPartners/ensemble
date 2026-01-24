#!/bin/bash

echo "AI Mesh Plugins Monorepo - Structure Verification"
echo "=================================================="
echo ""

# Count packages
PACKAGE_COUNT=$(find packages -mindepth 1 -maxdepth 1 -type d | wc -l)
echo "✅ Packages created: $PACKAGE_COUNT / 20"

# Verify each package has required files
echo ""
echo "Package Manifest Verification:"
for pkg in packages/*; do
  pkg_name=$(basename "$pkg")
  has_plugin_json=false
  has_package_json=false
  has_readme=false
  has_changelog=false
  
  [ -f "$pkg/.claude-plugin/plugin.json" ] && has_plugin_json=true
  [ -f "$pkg/package.json" ] && has_package_json=true
  [ -f "$pkg/README.md" ] && has_readme=true
  [ -f "$pkg/CHANGELOG.md" ] && has_changelog=true
  
  if $has_plugin_json && $has_package_json && $has_readme && $has_changelog; then
    echo "  ✅ $pkg_name - Complete"
  else
    echo "  ❌ $pkg_name - Missing files"
    $has_plugin_json || echo "     - plugin.json missing"
    $has_package_json || echo "     - package.json missing"
    $has_readme || echo "     - README.md missing"
    $has_changelog || echo "     - CHANGELOG.md missing"
  fi
done

# Count all files
echo ""
echo "File Statistics:"
echo "  Total files created: $(find . -type f ! -path './.git/*' | wc -l)"
echo "  plugin.json files: $(find packages -name plugin.json | wc -l)"
echo "  package.json files: $(find packages -name package.json | wc -l)"
echo "  README.md files: $(find packages -name README.md | wc -l)"
echo "  CHANGELOG.md files: $(find packages -name CHANGELOG.md | wc -l)"
echo "  .gitkeep files: $(find packages -name .gitkeep | wc -l)"

# Verify root files
echo ""
echo "Root Configuration:"
[ -f "package.json" ] && echo "  ✅ package.json" || echo "  ❌ package.json"
[ -f "marketplace.json" ] && echo "  ✅ marketplace.json" || echo "  ❌ marketplace.json"
[ -f "README.md" ] && echo "  ✅ README.md" || echo "  ❌ README.md"
[ -f "CHANGELOG.md" ] && echo "  ✅ CHANGELOG.md" || echo "  ❌ CHANGELOG.md"
[ -f "CONTRIBUTING.md" ] && echo "  ✅ CONTRIBUTING.md" || echo "  ❌ CONTRIBUTING.md"
[ -f "LICENSE" ] && echo "  ✅ LICENSE" || echo "  ❌ LICENSE"
[ -f ".gitignore" ] && echo "  ✅ .gitignore" || echo "  ❌ .gitignore"
[ -f ".npmrc" ] && echo "  ✅ .npmrc" || echo "  ❌ .npmrc"

# Verify schemas
echo ""
echo "Schemas:"
[ -f "schemas/plugin-schema.json" ] && echo "  ✅ plugin-schema.json" || echo "  ❌ plugin-schema.json"
[ -f "schemas/marketplace-schema.json" ] && echo "  ✅ marketplace-schema.json" || echo "  ❌ marketplace-schema.json"

# Verify workflows
echo ""
echo "GitHub Workflows:"
[ -f ".github/workflows/validate.yml" ] && echo "  ✅ validate.yml" || echo "  ❌ validate.yml"
[ -f ".github/workflows/test.yml" ] && echo "  ✅ test.yml" || echo "  ❌ test.yml"
[ -f ".github/workflows/release.yml" ] && echo "  ✅ release.yml" || echo "  ❌ release.yml"

# Verify scripts
echo ""
echo "Automation Scripts:"
[ -f "scripts/validate-all.js" ] && echo "  ✅ validate-all.js" || echo "  ❌ validate-all.js"
[ -f "scripts/publish-plugin.js" ] && echo "  ✅ publish-plugin.js" || echo "  ❌ publish-plugin.js"

echo ""
echo "=================================================="
echo "✅ Structure verification complete!"
