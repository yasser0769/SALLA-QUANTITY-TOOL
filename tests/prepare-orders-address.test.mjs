import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../prepare-orders.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'prepare-orders script must exist');
const context = vm.createContext({});
vm.runInContext(script.replace(/loadSettings\(\);\s*setupDropZone\(\);\s*checkReady\(\);\s*$/, ''), context);

const address = 'Al Yasmin District, King Abdulaziz Street, Building 123, Apartment 456';
const row = {
  COrderID: 'SALLA-1001', FirstName: 'Ali', LastName: 'Ahmed',
  Address: address, Address2: 'EEDA8685', City: 'Riyadh', State: 'Riyadh', Zip: '12345', Phone: '966500000000',
  __supplierItems: [{ sku: '567086', quantity: 1 }], __supplierStatus: 'ok'
};
const prepared = vm.runInContext(`shippingAddressLines(${JSON.stringify(address)}, 'EEDA8685', 'SALLA-1001')`, context);
assert.ok(prepared.first.length <= 60);
assert.equal(prepared.first, 'Al Yasmin District, King Abdulaziz Street');
assert.equal(prepared.second, 'EEDA8685');
context.rawForTest = [{ orderId: 'SALLA-1001', address: '', city: 'Riyadh', phone: '0500000000', products: '' }];
context.aiForTest = [{ orderId: 'SALLA-1001', address, address2: 'EEDA8685' }];
const mapped = vm.runInContext('mapOrderData(rawForTest, aiForTest)', context)[0];
assert.equal(mapped.Address, prepared.first);
assert.equal(mapped.Address2, 'EEDA8685');

context.rowForTest = row;
const payload = vm.runInContext('orderPlacementPayload([rowForTest])', context)[0];
assert.equal(payload.shippingAddress.address1, prepared.first);
assert.equal(payload.shippingAddress.address2, prepared.second);
vm.runInContext('outputRows = [rowForTest]', context);
const csv = vm.runInContext('csvText()', context);
assert.ok(csv.includes(prepared.first));
assert.ok(csv.includes(prepared.second));
assert.ok(!csv.includes(address));

context.rowForTest.Address = 'A'.repeat(61);
assert.match(vm.runInContext('validateOrderForPlacement(rowForTest)', context), /لا يمكن اختصار/);
assert.throws(() => vm.runInContext('csvText()', context), /لا يمكن اختصار/);
assert.match(vm.runInContext('orderExecutionLabel(rowForTest)', context), /لا يمكن اختصار/);
