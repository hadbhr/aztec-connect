const { writeFileSync, copyFileSync } = require('fs');

copyFileSync('README.md', './dest/README.md');

const package = require('./package.json');
const { jest, scripts, devDependencies, ...pkg } = package;

package.dependencies['@aztec/barretenberg'] = 'file:../../barretenberg.js/dest';
package.dependencies['@aztec/blockchain'] = 'file:../../blockchain/dest';
package.dependencies['@aztec/sriracha'] = 'file:../../sriracha/dest';
writeFileSync('./dest/package.json', JSON.stringify(pkg, null, '  '));

package.dependencies['@aztec/barretenberg'] = '^2.0.0';
package.dependencies['@aztec/blockchain'] = '^2.0.0';
package.dependencies['@aztec/sriracha'] = '^2.0.0';
writeFileSync('./dest/package.npm.json', JSON.stringify(pkg, null, '  '));
