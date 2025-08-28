const crypto = require('crypto');

// Generate and display the key
const jwtSecret = crypto.randomBytes(64).toString('hex');
console.log('Your new JWT Secret:');
console.log(jwtSecret);
console.log('\nAdd this to your .env file:');
console.log(`JWT_SECRET=${jwtSecret}`);