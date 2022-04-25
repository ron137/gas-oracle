const Web3 = require('web3');
const fs = require('fs');

const args = {
    network: 'ethereum',
    sampleSize: 1000,
};

// receive args
process.argv.forEach((val, index, array) => {
    if ((val == '-n' || val == '--network') && array[index+1]){
        args.network = array[index+1];
    }
    if ((val == '-s' || val == '--sample-size') && array[index+1]){
        args.sampleSize = array[index+1];
    }
    if ((val == '-t' || val == '--time-interval') && array[index+1]){
        args.timeInterval = array[index+1];
    }
});


const rpc = {
    last: 0,
    connected: false,
    blocks: {},
    sampleSize: args.sampleSize, // number of samples analized
    // speedSize: [35, 60, 90, 100], // percent of blocks accepted for each speed
    timeInterval: args.timeInterval || 1000,
    minInterval: 100,
    maxInterval: 15000,

    connect: async function(){

        console.log('Starting gas oracle...');

        try {
            // this.web3 = new Web3(new Web3.providers.HttpProvider(url[args.network]));
            if (!(await this.loadRPC({ first: true }))) {
                throw new Error('Network not available');
            }

            // this.web3.setProvider(url[args.network]);
            // this.web3.eth.extend({
            //     property: 'txpool',
            //     methods: [{
            //         name: 'content',
            //         call: 'txpool_content'
            //     }, {
            //         name: 'inspect',
            //         call: 'txpool_inspect'
            //     }, {
            //         name: 'status',
            //         call: 'txpool_status'
            //     }]
            // });
    
            // if (!(await this.testTxpool())){
            //     process.stdout.write(`Current RPC endpoint does not expose Txpool.\n`);    
            //     return false;
            // }

            this.last = await this.web3.eth.getBlockNumber();
            this.connected = true;
            process.stdout.write(`Connected to ${args.network} RPC. Fetching ${this.sampleSize} blocks before serving data.\n`);

            if (!(await this.getBaseFee('latest'))){
                this.legacyGas = true;
                console.log('Using legacy gas');
            }
        }
        catch(error){
            console.log(error);
            return new Error(error);
        }

        return this.web3;
    },

    loadRPC: async function({ index=false, first=false }={}) {
        const url = require(`./rpcs.json`);

        // no network, or wrong network passed
        if (!url[args.network]){
            return false;
        }

        // there is only one rpc
        if (!Array.isArray(url[args.network])) {
            this.web3 = new Web3(url[args.network]);
            return true;
        }

        // there is index arg
        if (index) {
            this.web3 = new Web3(url[args.network][index]);
            return true;
        }

        const getBestRPC = async () => {
            // from all rpcs, return last block from all in an object
            const lastBlocks = await Promise.all(url[args.network].map(async rpc => {
                try {
                    const web3 = new Web3(rpc);
                    return { 
                        rpc: rpc,
                        lastBlock: await web3.eth.getBlockNumber(),
                    };
                }
                catch(error) {
                    return {
                        rpc: rpc,
                        error: error,
                    }
                }
            }));
            // console.log(lastBlocks)
            // filter only non-error rpcs
            // sort ascending and get first = best rpc
            return lastBlocks.filter(e => !e.error).sort((a,b) => b.lastBlock - a.lastBlock)[0];
        }

        if (first) {
            const firstRPC = (await Promise.allSettled(url[args.network].map(async rpc => {
                try {
                    const web3 = new Web3(rpc);
                    await web3.eth.getBlock('latest', true);
                    return rpc;
                }
                catch(error) {}
            }))).find(e => e.status == 'fulfilled');
            this.web3 = new Web3(firstRPC.value);
            return true;
        }

        // this is the first time run
        if (!this.web3) {
            this.web3 = new Web3((await getBestRPC()).rpc);
            return true;
        }

        // calculate time diff between last reported timestamp and now
        const stats = require(`./blockStats_${args.network}.json`);
        const timeDiff = Math.abs(new Date().getTime() / 1000 - stats.lastTime);    
        const timeLimit = 300; // 5 minutes
        if (timeDiff > timeLimit) {
            const bestRPC = await getBestRPC();
            console.log(`Switching rpc to ${ bestRPC.rpc }`);
            this.web3 = new Web3(bestRPC.rpc);
            return true;
        }

        return false;
    },

    getBlock: async function(num='latest') {
        if (!this.connected){
            throw new Error('Not connected');
        }

        try {
            const block = await this.web3.eth.getBlock(num, true);
            return block;
        }
        catch(error){
            // console.log(error);
            return new Error(error);
        }
    },

    getBaseFee: async function(num='latest') {
        try {
            const history = await this.web3.eth.getFeeHistory(1, num, [0]);
            if (history.baseFeePerGas) {
                return parseInt(history.baseFeePerGas[0]) / 1000000000;
            }
        }
        catch (error) {
            // console.log('Error retieving base gas fee');
            return null;
        }
        return 0;
    },

    loop: async function(){
        try {
            // update scan to last block every 100 blocks
            const toScan = this.last % 100 == 0 ? 'latest' : this.last;
            let promises = [ this.getBlock(toScan) ];

            if (!this.legacyGas) {
                promises.push(this.getBaseFee(toScan));
            }

            promises = await Promise.allSettled(promises);

            const block = promises[0].status == 'fulfilled' ? promises[0].value : null;
            if (!this.legacyGas && block) {
                block.baseFee = promises[1].status == 'fulfilled' ? promises[1].value : null;
            }

            // check if its a new block
            let fetchState = 0;
            let sortedBlocks = Object.keys(this.blocks).sort();
            if (block && block.transactions && block.number >= this.last) {
                // save the block
                this.recordBlock(block);
                // call to update monited wallets. required only if want to monitor txs to target addresses
                // db.updateWallets(block, args.network);
                this.last = block.number + 1;
                fetchState = 1;
            }
            if (sortedBlocks.length < this.sampleSize && sortedBlocks.length > 0){
                // get block already in the stat file

                let exBlock = this.getExistingBlock(sortedBlocks[0] - 1);
                while (exBlock) {
                    this.recordBlock(exBlock, true);
                    sortedBlocks = Object.keys(this.blocks).sort();
                    exBlock = this.getExistingBlock(sortedBlocks[0] - 1);
                }

                // there is not a next block yet, fetch a previous block
                const newblock = await this.getBlock(sortedBlocks[0] - 1);
                if (newblock && newblock.transactions) {
                    this.recordBlock(newblock);
                }

                fetchState = -1;
            }

            if (fetchState == 0) {
                console.log(`Failed to fetch new blocks. I will try again in ${ this.timeInterval.toFixed(1) }ms`);
                await this.loadRPC();
            }

            setTimeout(() => this.loop(), this.dynamicInterval(fetchState));
        }
        catch (error){
            console.log(error);
        }
    },

    recordBlock: function(block, cache=false) {
        if (cache) {
            this.blocks[block.number] = {
                ntx: block.ntx,
                timestamp: block.timestamp,
                minGwei: block.minGwei,
                avgGas: block.avgGas,
            };

            if (block.baseFee) {
                this.blocks[block.number].baseFee = block.baseFee;
            }
            console.log(`Block ${block.number} hit cache`);
        }
        else {
            // extract the gas from transactions
            const transactions = block.transactions.filter(t => t.gasPrice && t.gasPrice != '0').map(t => parseFloat(this.web3.utils.fromWei(t.gasPrice, 'gwei'))).sort((a,b) => a - b);
            this.blocks[block.number] = {
                ntx: transactions.length,
                timestamp: block.timestamp,
                minGwei: [],
                avgGas: [],
            };

            if (!this.legacyGas){
                this.blocks[block.number].baseFee = block.baseFee;
            }

            if (transactions.length){
                // set average gas per tx in the block
                const avgGas = parseInt(block.gasUsed) / transactions.length;

                this.blocks[block.number].minGwei = transactions;
                this.blocks[block.number].avgGas = avgGas;
            }
        }

        // sort the blocks and discard if higher than sampleSize
        const sortedBlocks = Object.keys(this.blocks).sort((a,b) => parseInt(a) - parseInt(b));
        if (sortedBlocks.length > this.sampleSize){
            delete this.blocks[sortedBlocks[0]];

            this.calcBlockStats();
            console.log(`${new Date().toISOString()}: New block ${block.number} read. Next update: ${this.timeInterval.toFixed(1)}ms`);
            // console.log(`Time: elapsed: ${new Date().getTime() - this.time}`);
        }
        else{
            // pretty progress bar
            const barSize = 50;
            const filledBars = parseInt(sortedBlocks.length / this.sampleSize * barSize);
            const barString = [...Array(filledBars).fill('#'), ...Array(barSize - filledBars).fill('=')].join('');
            if (sortedBlocks.length == this.sampleSize){
                const barString = Array(barSize).fill('#').join('');
                console.log(`[${barString}] ${sortedBlocks.length} / ${this.sampleSize}`);
                // process.stdout.write(`\r[${barString}] ${this.sampleSize} / ${this.sampleSize}\n`);
            }
            else{
                console.log(`[${barString}] ${sortedBlocks.length} / ${this.sampleSize}`);
                // process.stdout.write(`\r[${barString}] ${sortedBlocks.length} / ${this.sampleSize}`);
            }
        }
    },

    calcBlockStats: function(){
        // sort blocks by timestamp, then remove blocks with no tx
        const b = Object.values(this.blocks).sort((a,b) => a.timestamp - b.timestamp).filter(e => e.ntx);

        // reshape blocks object to be arrays of each field
        const result = Object.fromEntries(Object.keys(b[0]).map(e => [e, []]));
        b.forEach(block => Object.keys(result).forEach(key => result[key].push(block[key])));

        // last block
        const lastBlock = parseInt(Object.keys(this.blocks).sort((a,b) => parseInt(b) - parseInt(a))[0]);
        result.lastBlock = lastBlock;
        // timestamp from last block
        result.lastTime = this.blocks[lastBlock].timestamp;

        fs.writeFileSync(`${__dirname}/blockStats_${args.network}.json`, JSON.stringify(result));
        return result;
    },

    getExistingBlock: function(num) {
        const stats = require(`./blockStats_${args.network}.json`);

        // there is no such block in cache
        if (num <= stats.lastBlock - stats.ntx.length || num > stats.lastBlock){
            return false;
        }

        // get the index to be fetched from the file
        const index = stats.ntx.length - (stats.lastBlock - num) - 1;
        // build a new stats object, where only the index element is present in array values
        const block = Object.fromEntries(Object.keys(stats).filter(e => Array.isArray(stats[e])).map(e => [ e, stats[e][index] ]));
        block.number = num;
        return block;
    },

    // if you want the oracle to return directly the speeds
    // calcSpeeds: function(){
    //     // sort blocks by timestamp, then remove blocks with no tx
    //     const b = Object.values(this.blocks).sort((a,b) => a.timestamp - b.timestamp).filter(e => e.ntx);
        
    //     const avgTx = b.map(e => e.ntx).reduce((p,c) => p+c, 0) / b.length;
    //     // avg time between the sample
    //     const avgTime = (b.slice(-1)[0].timestamp - b[0].timestamp) / (b.length - 1);
        
    //     // sort gwei array ascending so I can pick directly by index
    //     const sortedGwei = b.map(e => e.minGwei).sort((a,b) => parseFloat(a) - parseFloat(b));
    //     const speeds = this.speedSize.map(speed => {
    //         // get gwei corresponding to the slice of the array
    //         const poolIndex = parseInt(speed / 100 * b.length) - 1;
    //         const speedGwei = sortedGwei[poolIndex];

    //         // get average time for each speed
    //         const accepted = b.filter(e => e.minGwei <= speedGwei);
    //         const avgTime = (accepted.slice(-1)[0].timestamp - accepted[0].timestamp) / (accepted.length - 1);

    //         return speedGwei;
    //     });

    //     const result = {
    //         lastBlock: this.last,
    //         avgTime: avgTime,
    //         avgTx: avgTx,
    //         speeds: speeds,
    //     }

    //     fs.writeFileSync(`${__dirname}/predicted_gwei.json`, JSON.stringify(result));
    //     return result;
    // },

    dynamicInterval: function(state) {
        const speedFactor = 1.1;
        // not yet started
        if (state === -1) {
            this.timeInterval = 10;
        }
        // fetch success
        if (state === 1){
            // increase speed
            this.timeInterval /= speedFactor;
            this.timeInterval = Math.max(this.minInterval, this.timeInterval);
        }
        // fetch fail
        else {
            // reduce speed
            this.timeInterval *= speedFactor;
            this.timeInterval = Math.min(this.maxInterval, this.timeInterval);
        }
    
        return this.timeInterval;
    },
    

    // testing methods

    // testTxpool: async function(){
    //     try {
    //         const test = await this.web3.eth.txpool.status();
    //         if (test.pending){
    //             return true;
    //         }
    //     }
    //     catch(error) {
    //         return false;
    //     }
    //     return false;
    // },

    // getTxPool: async function(){
    //     // get transaction hash and gwei from txpool
    //     try {
    //         const content = await this.web3.eth.txpool.content();
    //         const transactions = [];
    //         Object.values(content).forEach(type => {
    //             Object.values(type).forEach(from => {
    //                 transactions.push(...Object.values(from).map(e => { return {
    //                     hash: e.hash,
    //                     gasPrice: parseFloat(this.web3.utils.fromWei(e.gasPrice, 'gwei')),
    //                 }}));
    //             });
    //         });
    //         // console.log(content);
    //         return transactions;
    //     }
    //     catch(error){
    //         console.log('error');
    //         return new Error(error);
    //     }
    // },

    // calc: async function(){
    //     const nBlocks = 200;
    //     const poolPromise = this.getTxPool();
    //     let predicted = JSON.parse(fs.readFileSync(`${__dirname}/predicted_gwei.json`));

    //     // wait until you have X blocks ahead of the txpool we are looking at
    //     const waitBlocks = async target => {
    //         predicted = JSON.parse(fs.readFileSync(`${__dirname}/predicted_gwei.json`));
    //         const lastBlock = parseInt(predicted.lastBlock);

    //         if (lastBlock >= target){
    //             return true;
    //         }
    //         process.stdout.write(`\rWaiting on block ${target}. Now: ${lastBlock}`);
    //         return await new Promise(resolve => setTimeout(async () => resolve(await waitBlocks(target)), 1000));
    //     }

    //     console.log('Waiting for blocks...');
    //     await waitBlocks(parseInt(predicted.lastBlock) + nBlocks);        
    //     console.log('\nWaiting for Txpool...');
    //     const pool = await poolPromise;
        
    //     if (!Array.isArray(pool)){
    //         console.log('Error retrieving txpool');
    //         return;
    //     }

    //     const speeds = [...predicted.speeds, 10000000];

    //     // get last X blocks
    //     const blocks = JSON.parse(fs.readFileSync(`${__dirname}/blocks.json`));
    //     const minedTransactions = speeds.map(e => []);
    //     Object.values(blocks).slice(-nBlocks).forEach((block,ib) => {
    //         // save only transactions mined fitting each gas price
    //         block.transactions.forEach(transaction => {
    //             speeds.forEach((speed,is) => {
    //                 if (!minedTransactions[is][ib]){
    //                     minedTransactions[is][ib] = [];
    //                 }
    //                 if (transaction.gasPrice <= speed){
    //                     minedTransactions[is][ib].push(transaction.hash);
    //                 }
    //             });
    //         });
    //     });

    //     // console.log(...minedTransactions);
        
    //     const minedPool = speeds.map(e => []);
    //     pool.forEach(transaction => {
    //         minedTransactions.forEach((speed,is) => {
    //             speed.forEach((block,ib) => {
    //                 if (!minedPool[is][ib]){
    //                     minedPool[is][ib] = [];
    //                 }
    //                 if (block.includes(transaction.hash)){
    //                     minedPool[is][ib].push(transaction.hash);
    //                 }
    //             });
    //         })
    //     });

    //     fs.writeFileSync(`${__dirname}/predict_time.json`, JSON.stringify(minedPool.map(e => e.map(e => e.length))));
    //     console.log('DONE')
    // }
};

rpc.connect().then(() => rpc.loop(), console.log);
