import {authSecrets} from './auth-secrets.mjs';
authSecrets(process.env);
console.log('Authentication and verification secrets passed release preflight.');
