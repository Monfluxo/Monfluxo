import test from 'node:test';
import assert from 'node:assert/strict';
import {sealAdminSession,readAdminSession,adminKeyForRequest,adminCookie} from '../web/lib/adminSession.js';
test('admin session encrypts the credential, authenticates ciphertext, expires and fails closed',t=>{
 const previous=process.env.MONFLUXO_ADMIN_SESSION_SECRET;process.env.MONFLUXO_ADMIN_SESSION_SECRET='a'.repeat(64);t.after(()=>{if(previous===undefined)delete process.env.MONFLUXO_ADMIN_SESSION_SECRET;else process.env.MONFLUXO_ADMIN_SESSION_SECRET=previous;});
 const now=Date.now(),key='private-admin-credential',value=sealAdminSession(key,now);
 assert.equal(value.includes(key),false);assert.equal(readAdminSession(value,now),key);
 assert.equal(readAdminSession(value,now+3600001),null);
 const bytes=Buffer.from(value,'base64url');bytes[29]^=1;assert.equal(readAdminSession(bytes.toString('base64url'),now),null);
 assert.equal(adminKeyForRequest({headers:new Headers({'x-monfluxo-admin-key':key})}),null);
 assert.equal(adminKeyForRequest({headers:new Headers({cookie:`mf_admin_session=${value}`})}),key);
 delete process.env.MONFLUXO_ADMIN_SESSION_SECRET;assert.equal(readAdminSession(value,now),null);
});
test('admin cookie is HttpOnly, SameSite Strict and secure in production',t=>{const old=process.env.NODE_ENV;process.env.NODE_ENV='production';t.after(()=>{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;});assert.match(adminCookie('token'),/HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure/);assert.match(adminCookie('',0),/Max-Age=0/);});
