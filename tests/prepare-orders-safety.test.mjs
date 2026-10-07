import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../prepare-orders.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/loadSettings\(\);\s*setupDropZone\(\);\s*checkReady\(\);\s*$/, '');

function context() {
  const storage = new Map();
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value:'shared-secret', disabled:false, textContent:'', classList:{add(){},remove(){}}, style:{} });
    return elements.get(id);
  };
  const ctx = vm.createContext({
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    document:{getElementById:get}, crypto:{randomUUID:()=> 'frontend-attempt-0001'},
    confirm:()=>true, setTimeout, fetch:async()=>{ throw new Error('unmocked fetch'); }
  });
  vm.runInContext(source,ctx);
  vm.runInContext('renderPreview=()=>{}; log=()=>{}; fetchSupplierCosts=async()=>{};',ctx);
  ctx.fixture = {
    __rowKey:'row-1', COrderID:'100001', FirstName:'Ali', LastName:'Ahmed',
    Address:'Al Yasmin', Address2:'RAYB7802', City:'Riyadh', State:'Riyadh', Zip:'13322', Phone:'966500000000',
    OrderDetails:'2,542940|', __supplierItems:[{sku:'542940',quantity:2}], __supplierStatus:'ok',
    __supplierLandedCost:100, __fragrancexStatus:'', GiftWrap:'n'
  };
  vm.runInContext('outputRows=[fixture]; selectedOrderKeys.add(fixture.__rowKey); historyReady=true;',ctx);
  return {ctx,storage,get};
}

test('a charged request with response loss becomes unknown and cannot be sent twice',async()=>{
  const {ctx,storage,get}=context();
  let calls=0;
  ctx.fetch=async()=>{ calls++; throw new Error('connection closed after dispatch'); };
  await vm.runInContext('placeSelectedOrders()',ctx);
  assert.equal(ctx.fixture.__fragrancexStatus,'unknown');
  assert.equal(JSON.parse(storage.get('fragrancex-order-history-v1'))['100001'].status,'unknown');
  vm.runInContext('checkReady()',ctx);
  assert.equal(get('placeSelectedBtn').disabled,true);
  await vm.runInContext('placeSelectedOrders()',ctx);
  assert.equal(calls,1);
});

test('reimport restores server history and blocks both execution and CSV export',async()=>{
  const {ctx,get}=context();
  ctx.fetch=async()=>({ok:true,json:async()=>({results:[{referenceId:'100001',orderId:'75062344',orderIds:['75062344','75062488'],status:'duplicate',resultCode:1}]})});
  await vm.runInContext('refreshOrderHistory()',ctx);
  assert.equal(ctx.fixture.__fragrancexStatus,'duplicate');
  vm.runInContext('selectedOrderKeys.add(fixture.__rowKey); checkReady()',ctx);
  assert.equal(get('placeSelectedBtn').disabled,true);
  assert.throws(()=>vm.runInContext('csvText()',ctx),/منفذ أو يحتاج مراجعة/);
  assert.match(vm.runInContext('orderExecutionLabel(fixture)',ctx),/75062488/);
});

test('ledger read failure disables execution even when local results look new',async()=>{
  const {ctx,get}=context();
  ctx.fetch=async()=>({ok:false,json:async()=>({error:'ledger unavailable'})});
  await vm.runInContext('refreshOrderHistory()',ctx);
  vm.runInContext('checkReady()',ctx);
  assert.equal(get('placeSelectedBtn').disabled,true);
});

test('invalid item edits clear old hidden items and original reference stays immutable',()=>{
  const {ctx}=context();
  vm.runInContext("editCell(0,'COrderID','different-order'); editCell(0,'OrderDetails','2,SKU542940|');",ctx);
  assert.equal(ctx.fixture.COrderID,'100001');
  assert.equal(ctx.fixture.__supplierItems.length,0);
  assert.equal(ctx.fixture.__supplierStatus,'error');
  assert.throws(()=>vm.runInContext("parseOrderItems('(SKU: 542940) Kaloo (Qty: 2) (SKU: 421416) Curve')",ctx),/بعض منتجات/);
});

test('selection and deletion remain frozen during dispatch',()=>{
  const {ctx}=context();
  vm.runInContext("placingOrders=true; toggleOrderSelection('row-1',false); deleteSelectedOrders(); clearResults(); editCell(0,'OrderDetails','1,421416|');",ctx);
  assert.equal(vm.runInContext('outputRows.length',ctx),1);
  assert.equal(vm.runInContext('selectedOrderKeys.size',ctx),1);
  assert.equal(ctx.fixture.OrderDetails,'2,542940|');
});
