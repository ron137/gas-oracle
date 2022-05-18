const fetch = require('node-fetch');
const fs = require('fs');


const args = {
    sampleSize: 1000,
    timeInterval: 5000,
    network: 'cosmoshub',
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


let lastBlock = 0;
let timeInterval = args.timeInterval;
let apiURL;
const blocks = {};

// get latest block number
const getBlockHeight = async url => {
    try {
        const res = await fetch(`${url || apiURL}/cosmos/base/tendermint/v1beta1/blocks/latest`);
        const block = await res.json();
        // console.log(block)
        const height = parseInt(block.block.header.height);

        return height;
    }
    catch (error) {
        console.log(error);
        return false;
    }
};


// get resp api provider
const getBestAPI = async () => {
    const providers = await (async () => {
        const req = await fetch(`https://registry.ping.pub/${ args.network }/chain.json`);
        return await req.json();
    })();
    // console.log(providers);

    const times = await Promise.all(providers.apis.rest.map(async e => getBlockHeight(e.address)));
    // console.log(times);

    const besti = times.indexOf(Math.max(...times));
    return providers.apis.rest[besti].address;
};


// get a list of gas prices for every tx in the block
const getBlock = async blockNumber => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.log('Request timed out');
    }, 10000);
  
    // in the future, maybe will switch to mintscan api
    // cosmos
    // https://api.mintscan.io/v1/cosmos/block/id/13932103
    // juno
    // https://api.mintscan.io/v1/juno/block/id/3145656
    // osmosis
    // https://api.mintscan.io/v1/osmosis/block/id/4434004
    let tx;
    try {
        const res = await fetch(`${apiURL}/cosmos/tx/v1beta1/txs?events=tx.height=${blockNumber}`, { signal: controller.signal });
        tx = await res.json();
    }
    catch (error) {
        console.log(error);
        return false;
    }
  
    clearTimeout(timeoutId);
    // console.log('txs:' + tx.txs.length)

    if (!tx.txs) {
        return false;
    }

    const feeList = tx.txs.map(e => {
        try {
            if (!e.auth_info.fee.amount.length) {
                return 0;
            }
            return parseFloat(e.auth_info.fee.amount[0].amount);
        }
        catch(error) {
            console.log(error);
            console.log(e);
            return 0;
        }
    }).filter(e => parseFloat(e) > 0);
    // console.log(feeList);

    if (!feeList.length) {
        return false;
    }

    const block = {
        feeList: feeList,
        number: blockNumber,
    };

    if (tx.tx_responses && tx.tx_responses.length) {
        block.timestamp = parseInt(new Date(tx.tx_responses[0].timestamp).getTime() / 1000);
        block.avgGas = tx.tx_responses.reduce((p,c) => p + parseFloat(c.gas_used), 0) / tx.tx_responses.length;
    }

    return block;
};


// automatically calculate time interval between calls
const dynamicInterval = (timeInterval, state) => {
    let minInterval = 1000;
    let maxInterval = 15000;
    const speedFactor = 1.1;

    // not yet started
    if (state === -1) {
        return 10;
    }
    // fetch success
    if (state === 1){
        // increase speed
        timeInterval /= speedFactor;
        timeInterval = Math.max(minInterval, timeInterval);
    }
    // fetch fail
    else {
        // reduce speed
        timeInterval *= speedFactor;
        timeInterval = Math.min(maxInterval, timeInterval);
    }

    return timeInterval;
};


const calcBlockStats = () => {
    // sort blocks by timestamp, then remove blocks with no tx
    const b = Object.values(blocks).sort((a,b) => a.timestamp - b.timestamp).filter(e => e.ntx);

    // reshape blocks object to be arrays of each field
    const result = Object.fromEntries(Object.keys(b[0]).map(e => [e, []]));
    b.forEach(block => Object.keys(result).forEach(key => result[key].push(block[key])));

    // last block
    const lastBlock = parseInt(Object.keys(blocks).sort((a,b) => parseInt(b) - parseInt(a))[0]);
    result.lastBlock = lastBlock;
    // timestamp from last block
    result.lastTime = blocks[lastBlock].timestamp;
    result.api = apiURL;

    fs.writeFileSync(`./blockStats_${args.network}.json`, JSON.stringify(result));
    return result;
};


const recordBlocks = async block => {
    blocks[block.number] = {
        ntx: block.feeList.length,
        timestamp: block.timestamp,
        minFee: block.feeList.sort((a,b) => a-b),
        avgGas: block.avgGas,
    };

    // console.log(block)
    // sort the blocks and discard if higher than sampleSize
    const sortedBlocks = Object.keys(blocks).sort((a,b) => parseInt(a) - parseInt(b));
    if (sortedBlocks.length > args.sampleSize){
        delete blocks[sortedBlocks[0]];

        calcBlockStats();
        console.log(`${new Date().toISOString()}: New block ${ block.number } read. Next update: ${ timeInterval.toFixed(1) }ms`);
    }
    else{
        // pretty progress bar
        const barSize = 50;
        const filledBars = parseInt(sortedBlocks.length / args.sampleSize * barSize);
        const barString = [...Array(filledBars).fill('#'), ...Array(barSize - filledBars).fill('=')].join('');
        if (sortedBlocks.length == args.sampleSize){
            const barString = Array(barSize).fill('#').join('');
            console.log(`[${barString}] ${sortedBlocks.length} / ${args.sampleSize}`);
        }
        else{
            console.log(`[${barString}] ${sortedBlocks.length} / ${args.sampleSize}`);
        }
    }

};


// check to see if this provider is lagging
const checkProvider = async () => {
    // calculate time diff between last reported timestamp and now
    const stats = JSON.parse(fs.readFileSync(`./blockStats_${args.network}.json`));
    const timeDiff = Math.abs(new Date().getTime() / 1000 - stats.lastTime);    
    const timeLimit = 300; // 5 minutes
    if (timeDiff > timeLimit) {
        // console.log(new Date().getTime() / 1000, stats.lastTime);
        apiURL = await getBestAPI();
        console.log(`Switching API provider to ${ apiURL }`);
    }
};


// loop function
const loop = async () => {
    let state = 0;

    const block = await getBlock(lastBlock);
    // console.log(block, lastBlock);

    if (block) {
        // console.log(block);
        if (block.feeList.length) {
            recordBlocks(block);
        }
        state = 1;
        lastBlock = lastBlock + 1;
    }
    else {
        // some blocks jump in cosmos, so we always get block height when fail
        lastBlock = Math.max(await getBlockHeight(), lastBlock);
    }

    // get previous blocks
    const sizeNow = Object.keys(blocks).length;
    if (sizeNow && sizeNow < args.sampleSize) {
        const firstBlock = Object.keys(blocks).sort((a,b) => a-b)[0];

        const blockReq = [];
        // make all requests at once (max 100)
        for (let i=0 ; i < Math.min(100, args.sampleSize - sizeNow) ; i++) {
            blockReq.push(getBlock(firstBlock - i));
        }
        const blockRes = await Promise.all(blockReq);
        blockRes.forEach(block => {
            if (block && block.feeList.length) {
                recordBlocks(block)
            }
        });

        state = -1;
    }

    if (state === 0) {
        console.log(`Failed to fetch new blocks. I will try again in ${ timeInterval.toFixed(1) }ms`);
        await checkProvider();
    }

    timeInterval = dynamicInterval(timeInterval, state);
    setTimeout(() => loop(), timeInterval);
};

(async () => {
    console.log('Starting gas oracle...');

    apiURL = await getBestAPI();
    console.log(`Fetching data for ${args.network} network from API: ${apiURL}.`);

    lastBlock = await getBlockHeight();

    loop();
})();