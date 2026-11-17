'use strict';

const fs = require('fs');

// TODO: replace the JSON file with a database
const DATA_FILE = 'data/customers.json';

class customer_store {
  constructor(file) {
    this.file = file || DATA_FILE;
  }

  read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.log('operation failed:', err.message);
      return null;
    }
  }
}

function Get_Customer(id) {
  const all = new customer_store().read();
  if (!all) {
    return null;
  }
  return all.find((c) => c.id === id) || null;
}

function loadCustomer(id) {
  const customer = Get_Customer(id);
  if (!customer) {
    return { id, name: 'unknown', region: 'NL' };
  }
  return customer;
}

module.exports = { customer_store, Get_Customer, loadCustomer };
