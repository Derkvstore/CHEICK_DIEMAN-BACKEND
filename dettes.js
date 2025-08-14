const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// Helper function to format amount (can be shared in a utils file later)
const formatCFA = (amount) => {
  if (amount === null || amount === undefined || isNaN(parseFloat(amount))) {
    return '0 CFA';
  }
  return Math.round(parseFloat(amount)).toLocaleString('fr-FR') + ' CFA';
};

// ROUTE 1: GET /api/dettes - Lister tous les clients avec leur dette totale
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT
        c.id AS client_id,
        c.nom AS client_nom,
        c.telephone AS client_telephone,
        COALESCE(SUM(f.montant_actuel_du), 0) AS dette_totale
      FROM
        clients c
      LEFT JOIN
        ventes v ON c.id = v.client_id
      LEFT JOIN
        factures f ON v.id = f.vente_id AND f.statut_facture NOT IN ('payee_integralement', 'annulee', 'retour_total')
      GROUP BY
        c.id, c.nom, c.telephone
      HAVING
        COALESCE(SUM(f.montant_actuel_du), 0) > 0
      ORDER BY
        dette_totale DESC;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erreur lors de la récupération des dettes clients:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des dettes.' });
  }
});

// ROUTE 2: POST /api/dettes/paiement - Encaisser un paiement global pour un client
router.post('/paiement', async (req, res) => {
  const { client_id, montant_encaisse } = req.body;
  let clientDb;

  if (!client_id || !montant_encaisse || isNaN(parseFloat(montant_encaisse)) || parseFloat(montant_encaisse) <= 0) {
    return res.status(400).json({ error: 'ID du client et un montant encaissé valide sont requis.' });
  }

  let montantRestantAPayer = parseFloat(montant_encaisse);

  try {
    clientDb = await pool.connect();
    await clientDb.query('BEGIN');

    // 1. Récupérer toutes les factures non payées du client, des plus anciennes aux plus récentes
    const facturesImpayeresResult = await clientDb.query(
      `SELECT
         f.id AS facture_id,
         f.montant_actuel_du,
         f.vente_id
       FROM factures f
       JOIN ventes v ON f.vente_id = v.id
       WHERE v.client_id = $1
         AND f.statut_facture NOT IN ('payee_integralement', 'annulee', 'retour_total')
         AND f.montant_actuel_du > 0
       ORDER BY f.date_facture ASC
       FOR UPDATE`, // FOR UPDATE pour verrouiller les lignes
      [client_id]
    );

    const facturesImpayeres = facturesImpayeresResult.rows;

    if (facturesImpayeres.length === 0) {
      await clientDb.query('ROLLBACK');
      return res.status(404).json({ error: 'Ce client n\'a aucune dette active.' });
    }

    // 2. Appliquer le paiement sur chaque facture
    for (const facture of facturesImpayeres) {
      if (montantRestantAPayer <= 0) break;

      const montantAPayerSurFacture = Math.min(montantRestantAPayer, parseFloat(facture.montant_actuel_du));

      // Mettre à jour la facture
      const newMontantActuelDu = parseFloat(facture.montant_actuel_du) - montantAPayerSurFacture;
      const newStatutFacture = newMontantActuelDu <= 0 ? 'payee_integralement' : 'paiement_partiel';

      await clientDb.query(
        `UPDATE factures
         SET montant_paye_facture = montant_paye_facture + $1,
             montant_actuel_du = $2,
             statut_facture = $3
         WHERE id = $4`,
        [montantAPayerSurFacture, newMontantActuelDu, newStatutFacture, facture.facture_id]
      );

      // Mettre à jour la vente correspondante
      await clientDb.query(
        `UPDATE ventes
         SET montant_paye = montant_paye + $1,
             statut_paiement = $2
         WHERE id = $3`,
        [montantAPayerSurFacture, newStatutFacture, facture.vente_id]
      );

      montantRestantAPayer -= montantAPayerSurFacture;
    }

    await clientDb.query('COMMIT');
    res.status(200).json({ message: `Paiement de ${formatCFA(montant_encaisse)} enregistré avec succès.` });

  } catch (error) {
    if (clientDb) await clientDb.query('ROLLBACK');
    console.error('Erreur lors de l\'enregistrement du paiement global:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement du paiement.' });
  } finally {
    if (clientDb) clientDb.release();
  }
});

module.exports = router;
