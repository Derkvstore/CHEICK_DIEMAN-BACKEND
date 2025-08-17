const jwt = require('jsonwebtoken');
const { pool } = require('./db');

// Middleware 1 : Vérification du token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token manquant.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide.' });
    }
    req.user = decoded; // decoded contient userId et role
    next();
  });
}

// Middleware 2 : Vérification des rôles
function checkRole(allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(403).json({ error: 'Accès refusé. Informations utilisateur manquantes.' });
      }

      // Vérification rapide du rôle directement depuis le JWT si possible
      const userRole = req.user.role;

      if (!userRole) {
        // fallback : récupérer depuis la base si JWT ne contient pas le rôle
        const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }
        req.user.role = result.rows[0].role;
      }

      if (allowedRoles.includes(req.user.role)) {
        return next();
      } else {
        return res.status(403).json({ error: `Accès refusé. Rôle "${req.user.role}" insuffisant.` });
      }
    } catch (err) {
      console.error('Erreur de vérification des rôles :', err);
      res.status(500).json({ error: 'Erreur serveur lors de la vérification des permissions.' });
    }
  };
}

module.exports = { authenticateToken, checkRole };
