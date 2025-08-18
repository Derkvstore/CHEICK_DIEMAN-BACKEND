// const bcrypt = require('bcrypt');

// bcrypt.hash('K3ita_7409', 10).then(hash => {
//   console.log('Hash généré :', hash);
// });


// const bcrypt = require('bcrypt');

// bcrypt.hash('Blopa7267', 10).then(hash => {
//   console.log('Hash généré :', hash);
// });


const bcrypt = require('bcrypt');

bcrypt.hash('TRUNCATE', 10).then(hash => {
  console.log('Hash généré :', hash);
});
