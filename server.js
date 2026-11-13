const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Catálogo actualizado incluyendo Cajas y Fragmentos Evo
const CATALOGO = [
    { id: 'ff-100', categoria: 'free-fire', nombre: '100 + 10 Diamantes FF', precioUsd: 1.10 },
    { id: 'ff-310', categoria: 'free-fire', nombre: '310 + 31 Diamantes FF', precioUsd: 3.20 },
    { id: 'ff-520', categoria: 'free-fire', nombre: '520 + 52 Diamantes FF', precioUsd: 5.20 },
    { id: 'ff-sem', categoria: 'free-fire', nombre: 'Tarjeta Semanal FF', precioUsd: 2.10 },

    // Cajas y Fragmentos Evo
    { id: 'evo-caja-1', categoria: 'cajas-evo', nombre: '1 Caja de fragmentos Evo', precioUsd: 0.03, precioBs: 35.00 },
    { id: 'evo-caja-5', categoria: 'cajas-evo', nombre: '5 Cajas de fragmentos Evo', precioUsd: 0.15, precioBs: 160.00 },
    { id: 'evo-caja-10', categoria: 'cajas-evo', nombre: '10 Cajas de fragmentos Evo', precioUsd: 0.30, precioBs: 320.00 },
    { id: 'evo-frag-10', categoria: 'cajas-evo', nombre: '10 Fragmentos de arma Evo', precioUsd: 1.49, precioBs: 1600.00 },
    { id: 'evo-caja-50', categoria: 'cajas-evo', nombre: '50 Cajas de fragmentos Evo', precioUsd: 1.49, precioBs: 1600.00 },
    { id: 'evo-frag-50', categoria: 'cajas-evo', nombre: '50 Fragmentos de arma Evo', precioUsd: 7.45, precioBs: 8000.00 },
    { id: 'evo-frag-100', categoria: 'cajas-evo', nombre: '100 Fragmentos de arma Evo', precioUsd: 14.90, precioBs: 16000.00 },
    { id: 'evo-frag-500', categoria: 'cajas-evo', nombre: '500 Fragmentos de arma Evo', precioUsd: 74.50, precioBs: 80000.00 },

    // Blood Strike
    { id: 'bs-100', categoria: 'blood-strike', nombre: '100 + 5 Oro Blood Strike', precioUsd: 1.05 },
    { id: 'bs-300', categoria: 'blood-strike', nombre: '300 + 20 Oro Blood Strike', precioUsd: 3.10 }
];

app.get('/api/catalogo', (req, res) => {
    res.json(CATALOGO);
});

app.post('/api/pedido', (req, res) => {
    const { playerId, producto, precio } = req.body;
    if (!playerId || !producto) {
        return res.status(400).json({ ok: false, mensaje: 'Faltan datos del pedido.' });
    }
    console.log(`[NUEVO PEDIDO] ID: ${playerId} | Producto: ${producto} | Monto: $${precio}`);
    res.json({
        ok: true,
        mensaje: `Pedido recibido: ${producto} para el ID ${playerId}. Procesando recarga...`
    });
});

app.listen(PORT, () => {
    console.log(`Servidor Sokovm activo en el puerto ${PORT}`);
});
