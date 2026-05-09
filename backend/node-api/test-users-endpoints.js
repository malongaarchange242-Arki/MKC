/**
 * Script de test pour les endpoints Users
 * Usage: node test-users-endpoints.js
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.API_URL || 'https://mkc-backend-cs7a.onrender.com';
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'Test123456!';

let authToken = null;
let userId = null;

// Couleurs pour la console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Helper pour faire des requêtes
async function makeRequest(method, url, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status || 500
    };
  }
}

// Tests
async function testHealthCheck() {
  logInfo('\n📋 Test 1: Health Check');
  const result = await makeRequest('GET', '/health');
  
  if (result.success) {
    logSuccess(`Health check OK - Status: ${result.status}`);
    logInfo(`Service: ${result.data.service}`);
    return true;
  } else {
    logError(`Health check failed - ${result.error.message || result.error}`);
    return false;
  }
}

async function testRegister() {
  logInfo('\n📋 Test 2: Register (pour obtenir un token)');
  
  // Générer un email unique
  const uniqueEmail = `test${Date.now()}@example.com`;
  
  const result = await makeRequest('POST', '/auth/register', {
    email: uniqueEmail,
    password: TEST_PASSWORD,
    nom: 'Test',
    prenom: 'User'
  });

  if (result.success && result.data.user) {
    logSuccess(`Register OK - User ID: ${result.data.user.id}`);
    userId = result.data.user.id;
    logWarning('Note: Vous devrez vous connecter pour obtenir un token');
    return true;
  } else {
    logError(`Register failed - ${JSON.stringify(result.error)}`);
    return false;
  }
}

async function testLogin() {
  logInfo('\n📋 Test 3: Login (pour obtenir un token)');
  
  // Utiliser l'email de test ou celui créé
  const email = userId ? `test${userId}@example.com` : TEST_EMAIL;
  
  const result = await makeRequest('POST', '/auth/login', {
    email: email,
    password: TEST_PASSWORD
  });

  if (result.success && result.data.session?.access_token) {
    authToken = result.data.session.access_token;
    logSuccess(`Login OK - Token obtenu`);
    logInfo(`Token: ${authToken.substring(0, 20)}...`);
    return true;
  } else {
    logError(`Login failed - ${JSON.stringify(result.error)}`);
    logWarning('Vous devrez créer un utilisateur manuellement et vous connecter');
    return false;
  }
}

async function testGetMe() {
  logInfo('\n📋 Test 4: GET /users/me');
  
  if (!authToken) {
    logWarning('Pas de token - Test ignoré');
    return false;
  }

  const result = await makeRequest('GET', '/users/me', null, {
    Authorization: `Bearer ${authToken}`
  });

  if (result.success) {
    logSuccess(`GET /users/me OK`);
    logInfo(`Profile: ${JSON.stringify(result.data.profile, null, 2)}`);
    return true;
  } else {
    logError(`GET /users/me failed - ${JSON.stringify(result.error)}`);
    return false;
  }
}

async function testUpdateMe() {
  logInfo('\n📋 Test 5: PATCH /users/me');
  
  if (!authToken) {
    logWarning('Pas de token - Test ignoré');
    return false;
  }

  const result = await makeRequest('PATCH', '/users/me', {
    nom: 'Updated',
    prenom: 'Name'
  }, {
    Authorization: `Bearer ${authToken}`
  });

  if (result.success) {
    logSuccess(`PATCH /users/me OK`);
    logInfo(`Updated profile: ${JSON.stringify(result.data.profile, null, 2)}`);
    return true;
  } else {
    logError(`PATCH /users/me failed - ${JSON.stringify(result.error)}`);
    return false;
  }
}

async function testListUsers() {
  logInfo('\n📋 Test 6: GET /users (ADMIN only)');
  
  if (!authToken) {
    logWarning('Pas de token - Test ignoré');
    return false;
  }

  const result = await makeRequest('GET', '/users', null, {
    Authorization: `Bearer ${authToken}`
  });

  if (result.success) {
    logSuccess(`GET /users OK`);
    logInfo(`Users count: ${result.data.count}`);
    return true;
  } else {
    if (result.status === 403) {
      logWarning('GET /users - Forbidden (normal si vous n\'êtes pas ADMIN)');
    } else {
      logError(`GET /users failed - ${JSON.stringify(result.error)}`);
    }
    return false;
  }
}

async function testGetUserById() {
  logInfo('\n📋 Test 7: GET /users/:id (ADMIN only)');
  
  if (!authToken || !userId) {
    logWarning('Pas de token ou userId - Test ignoré');
    return false;
  }

  const result = await makeRequest('GET', `/users/${userId}`, null, {
    Authorization: `Bearer ${authToken}`
  });

  if (result.success) {
    logSuccess(`GET /users/:id OK`);
    logInfo(`User: ${JSON.stringify(result.data.profile, null, 2)}`);
    return true;
  } else {
    if (result.status === 403) {
      logWarning('GET /users/:id - Forbidden (normal si vous n\'êtes pas ADMIN)');
    } else {
      logError(`GET /users/:id failed - ${JSON.stringify(result.error)}`);
    }
    return false;
  }
}

// Fonction principale
async function runTests() {
  log('\n🚀 Démarrage des tests des endpoints Users\n', 'blue');
  log(`Base URL: ${BASE_URL}\n`);

  const results = {
    healthCheck: await testHealthCheck(),
    register: await testRegister(),
    login: await testLogin(),
    getMe: await testGetMe(),
    updateMe: await testUpdateMe(),
    listUsers: await testListUsers(),
    getUserById: await testGetUserById()
  };

  // Résumé
  log('\n📊 RÉSUMÉ DES TESTS\n', 'blue');
  const passed = Object.values(results).filter(r => r === true).length;
  const total = Object.keys(results).length;
  
  Object.entries(results).forEach(([test, result]) => {
    if (result) {
      logSuccess(`${test}: PASSED`);
    } else {
      logError(`${test}: FAILED`);
    }
  });

  log(`\n✅ ${passed}/${total} tests réussis\n`);

  if (passed === total) {
    log('🎉 Tous les tests sont passés !', 'green');
  } else {
    log('⚠️  Certains tests ont échoué. Vérifiez les logs ci-dessus.', 'yellow');
  }
}

// Exécution
runTests().catch(error => {
  logError(`Erreur fatale: ${error.message}`);
  process.exit(1);
});

