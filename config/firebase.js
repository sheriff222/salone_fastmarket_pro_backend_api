// config/firebase.js
const admin = require('firebase-admin');
const path = require('path');

let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    console.log('✅ Firebase Admin already initialized');
    return firebaseApp;
  }

  try {
    let serviceAccount;

    // ✅ OPTION 1: Try environment variable first (for production/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('🔑 Loading Firebase credentials from environment variable...');
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } 
    // ✅ OPTION 2: Fallback to file path (for local development)
    else {
      console.log('📁 Loading Firebase credentials from file...');
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
        './firebase-service-account.json';
      serviceAccount = require(path.resolve(serviceAccountPath));
    }

    // Initialize Firebase Admin
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });

    console.log('✅ Firebase Admin initialized successfully');
    console.log(`📱 Project: ${serviceAccount.project_id}`);
    return firebaseApp;

  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
    
    // Provide helpful error messages
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error('💡 Solution: Either:');
      console.error('   1. Set FIREBASE_SERVICE_ACCOUNT environment variable with your JSON credentials');
      console.error('   2. Place firebase-service-account.json in your project root');
    }
    
    throw new Error('Firebase initialization failed: ' + error.message);
  }
};

const getMessaging = () => {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.messaging();
};

module.exports = {
  initializeFirebase,
  getMessaging,
  admin
};