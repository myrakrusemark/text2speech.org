export { openDatabase, storeDataInIndexedDB, getDataFromIndexedDB, deleteDataFromIndexedDB };

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('myDatabase', 2);

        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            db.createObjectStore('sessionData', { keyPath: 'id' });
        };

        request.onsuccess = function(event) {
            const db = event.target.result;
            resolve(db);
        };

        request.onerror = function(event) {
            console.error('Error opening database:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

async function storeDataInIndexedDB(key, value) {
    const db = await openDatabase();
    try {
        const transaction = db.transaction(['sessionData'], 'readwrite');
        const store = transaction.objectStore('sessionData');
        await new Promise((resolve, reject) => {
            const request = store.put({ id: key, value: value });
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.errorCode);
        });
    } finally {
        db.close();
    }
}

async function getDataFromIndexedDB(key) {
    const db = await openDatabase();
    try {
        const transaction = db.transaction(['sessionData'], 'readonly');
        const store = transaction.objectStore('sessionData');
        const result = await new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = (event) => resolve(event.target.result ? event.target.result.value : null);
            request.onerror = (event) => reject(event.target.errorCode);
        });
        return result;
    } finally {
        db.close();
    }
}

async function deleteDataFromIndexedDB(key) {
    const db = await openDatabase();
    try {
        const transaction = db.transaction(['sessionData'], 'readwrite');
        const store = transaction.objectStore('sessionData');
        await new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.errorCode);
        });
    } finally {
        db.close();
    }
}