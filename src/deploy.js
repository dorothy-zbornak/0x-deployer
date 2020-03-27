require('colors');
const FlexContract = require('flex-contract');
const fetch = require('node-fetch');
const process = require('process');
const { artifacts: assetProxyArtifacts } = require('@0x/contracts-asset-proxy');
const solpp = require('solpp');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const { URLSearchParams } = require('url');
const secrets = require('../secrets.json');

const NETWORKS = [
    'main',
    'ropsten',
    // 'kovan'
];

const BRIDGES_TO_DEPLOY = [
    // 'KyberBridge',
    // 'Eth2DaiBridge',
    // 'UniswapBridge',
    // 'CurveBridge',
    // 'DydxBridge',
    'DexForwarderBridge',
];

(async () => {
    const compilerInputs = {
        ..._.zipObject(BRIDGES_TO_DEPLOY, await Promise.all(BRIDGES_TO_DEPLOY.map(
            bridgeName => {
                const r = JSON.parse(fs.readFileSync(
                    require.resolve(`@0x/contracts-asset-proxy/test/generated-artifacts/${bridgeName}.input.json`),
                ));
                return r;
            },
        ))),
    };
    await Promise.all(NETWORKS.map(async network => {
        for (const bridgeName of BRIDGES_TO_DEPLOY) {
            const artifact = assetProxyArtifacts[bridgeName];
            const compilerInput = compilerInputs[bridgeName];
            const bridgeContract = new FlexContract(
                artifact.compilerOutput.abi,
                {
                    network,
                    bytecode: artifact.compilerOutput.evm.bytecode.object,
                    gasPriceBonus: 0.85,
                },
            );
            console.log(`Deploying bridge ${bridgeName.bold} on ${network}...`);
            const r = await bridgeContract.new().send({ key: secrets.deployerKey });
            if (!r.status) {
                throw new Error(`failed to deploy bridge ${bridgeName.bold} on ${network}`);
            }
            console.log(`Deployed ${bridgeName.bold} on ${network}: ${r.contractAddress.green.bold}`);
            try {
                await delay(() => verifySource({
                    network,
                    artifact,
                    compilerInput,
                    address: r.contractAddress,
                    name: bridgeName,
                }));
            } catch (err) {
                console.error(err);
            }
        }
    }));
})().catch(err => { console.error(err); process.exit(-1) }).then(() => process.exit(0));

async function delay(cb, delay=20) {
    return new Promise((accept, reject) => {
        setTimeout(() => {
            try {
                accept(cb());
            } catch (err) {
                reject(err);
            }
        }, delay * 1000);
    });
}

async function verifySource(opts) {
    const { network, address, name, compilerInput, artifact, libraries } = opts;
    const apiNetworkPrefix = network === 'main' ? 'api' : `api-${network}`;
    const params = new URLSearchParams();
    params.set('apikey', secrets.etherscanKey);
    params.set('module', 'contract');
    params.set('action', 'verifysourcecode');
    params.set('contractaddress', address);
    params.set('sourceCode', JSON.stringify(compilerInput));
    params.set('codeformat', 'solidity-standard-json-input');
    params.set('contractname', findContractPathSpec(compilerInput.sources, artifact.contractName));
    params.set('compilerversion', artifact.compiler.version.slice(0, -3).slice(8));
    params.set('licenseType', 12);
    // console.log(params);
    console.log(`Verifying source code for ${name.bold} on ${network} at ${address.green.bold}...`);
    const r = await fetch(
        `https://${apiNetworkPrefix}.etherscan.io/api`,
        {
            method: 'POST',
            body: params,
        },
    );
    const result = await r.json();
    if (result.status != '1') {
        throw new Error(`Verification failed: ${result.message}: ${result.result}`);
    }
    console.log(`Successfully verified source code for ${name.bold} on ${network} at ${address.green.bold} (ref: ${result.result})!`);
}

function findContractPathSpec(inputSources, name) {
    for (const file of Object.keys(inputSources)) {
        if (file.endsWith(`${name}.sol`)) {
            return `${file}:${name}`;
        }
    }
}
