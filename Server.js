require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { initRealtime } = require('./src/services/realtime');

// Porta do servidor
const PORT = process.env.PORT || 10000;

const server = http.createServer(app);

// Inicializa Socket.IO + eventos
initRealtime(server);

// Obter IP local automaticamente 
const os = require('os');
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

// Iniciar servidor aceitando conexões externas
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running`);
  console.log(`➡ Local:      http://localhost:${PORT}`);
  console.log(`➡ Na rede:    http://${localIP}:${PORT}`);
  console.log(`📱 Usa o endereço "Na rede" no teu telemóvel para aceder.`);
});
