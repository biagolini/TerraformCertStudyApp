export const environment = {
  production: false,
  apiUrl: 'https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/production',
  cognito: {
    userPoolId: 'us-east-1_XXXXXXXXX',
    clientId: 'your-cognito-client-id',
    domain: 'your-prefix.auth.us-east-1.amazoncognito.com',
    redirectUri: 'http://localhost:4200/callback',
    logoutUri: 'http://localhost:4200',
  },
};
