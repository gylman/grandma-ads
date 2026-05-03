import {
  decodeFunctionData,
  encodeFunctionResult,
  isAddress,
  isHex,
  parseAbi,
  zeroAddress,
  type Hex,
} from 'viem';
import { namehash } from 'viem/ens';
import { EnsIdentity } from '../../domain/ens';

export type EnsCcipReadInput = {
  sender: string;
  data: string;
  records: EnsIdentity[];
};

export type EnsCcipReadOutput = {
  data: Hex;
  sender: string;
  request: {
    functionName: string;
    ensName: string | null;
    recordKey: string | null;
  };
  record: EnsIdentity | null;
};

const resolverAbi = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function addr(bytes32 node, uint256 coinType) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)',
  'function resolve(bytes name, bytes data) view returns (bytes)',
]);

const addrAbi = parseAbi(['function addr(bytes32 node) view returns (address)']);
const addrCoinAbi = parseAbi(['function addr(bytes32 node, uint256 coinType) view returns (bytes)']);
const textAbi = parseAbi(['function text(bytes32 node, string key) view returns (string)']);

export function resolveEnsCcipRead(input: EnsCcipReadInput): EnsCcipReadOutput {
  const sender = input.sender.toLowerCase();
  if (!isAddress(sender)) throw new Error('sender must be an address');
  if (!isHex(input.data)) throw new Error('data must be 0x-prefixed calldata');

  const decoded = decodeResolverCall(input.data);
  if (decoded.functionName === 'resolve') {
    const [dnsEncodedName, innerData] = decoded.args;
    if (!isHex(dnsEncodedName) || !isHex(innerData)) {
      throw new Error('resolve(name,data) contained invalid bytes');
    }

    const ensName = decodeDnsEncodedName(dnsEncodedName);
    const record = findRecordByName(input.records, ensName);
    const resolved = resolveRecordCall({
      data: innerData,
      records: input.records,
      record,
      ensName,
    });

    return {
      data: resolved.data,
      sender,
      request: {
        functionName: `resolve.${resolved.functionName}`,
        ensName,
        recordKey: resolved.recordKey,
      },
      record: resolved.record,
    };
  }

  const resolved = resolveRecordCall({
    data: input.data,
    records: input.records,
    record: null,
    ensName: null,
  });

  return {
    data: resolved.data,
    sender,
    request: {
      functionName: resolved.functionName,
      ensName: resolved.ensName,
      recordKey: resolved.recordKey,
    },
    record: resolved.record,
  };
}

function resolveRecordCall(input: {
  data: Hex;
  records: EnsIdentity[];
  record: EnsIdentity | null;
  ensName: string | null;
}): {
  data: Hex;
  functionName: string;
  ensName: string | null;
  recordKey: string | null;
  record: EnsIdentity | null;
} {
  const decoded = decodeResolverCall(input.data);
  const [node] = decoded.args;
  const record = input.record ?? (isHex(node) ? findRecordByNode(input.records, node) : null);
  const ensName = input.ensName ?? record?.name ?? null;

  if (decoded.functionName === 'addr' && decoded.args.length === 1) {
    return {
      data: encodeFunctionResult({
        abi: addrAbi,
        functionName: 'addr',
        result: toAddress(record?.address),
      }),
      functionName: 'addr',
      ensName,
      recordKey: 'addr',
      record,
    };
  }

  if (decoded.functionName === 'addr' && decoded.args.length === 2) {
    const coinType = decoded.args[1];
    const address = coinType === 60n || coinType === 0n ? record?.address : null;
    return {
      data: encodeFunctionResult({
        abi: addrCoinAbi,
        functionName: 'addr',
        result: address && isAddress(address) ? address : '0x',
      }),
      functionName: 'addr',
      ensName,
      recordKey: `addr.${coinType?.toString() ?? 'unknown'}`,
      record,
    };
  }

  if (decoded.functionName === 'text') {
    const key = String(decoded.args[1] ?? '');
    return {
      data: encodeFunctionResult({
        abi: textAbi,
        functionName: 'text',
        result: record?.textRecords[key] ?? '',
      }),
      functionName: 'text',
      ensName,
      recordKey: key,
      record,
    };
  }

  throw new Error(`Unsupported resolver function: ${decoded.functionName}`);
}

function decodeResolverCall(data: Hex): { functionName: string; args: readonly unknown[] } {
  try {
    const decoded = decodeFunctionData({
      abi: resolverAbi,
      data,
    });
    return {
      functionName: decoded.functionName,
      args: decoded.args ?? [],
    };
  } catch {
    throw new Error('Unsupported ENS resolver calldata');
  }
}

function findRecordByName(records: EnsIdentity[], ensName: string): EnsIdentity | null {
  const normalizedName = ensName.toLowerCase();
  return records.find((record) => record.name.toLowerCase() === normalizedName) ?? null;
}

function findRecordByNode(records: EnsIdentity[], node: Hex): EnsIdentity | null {
  const normalizedNode = node.toLowerCase();
  return records.find((record) => namehash(record.name).toLowerCase() === normalizedNode) ?? null;
}

function toAddress(address: string | null | undefined): `0x${string}` {
  if (address && isAddress(address)) return address;
  return zeroAddress;
}

function decodeDnsEncodedName(value: Hex): string {
  const hex = value.slice(2);
  const labels: string[] = [];
  let index = 0;

  while (index < hex.length) {
    const length = Number.parseInt(hex.slice(index, index + 2), 16);
    index += 2;
    if (length === 0) break;

    const labelHex = hex.slice(index, index + length * 2);
    if (labelHex.length !== length * 2) {
      throw new Error('Invalid DNS-encoded ENS name');
    }

    labels.push(Buffer.from(labelHex, 'hex').toString('utf8'));
    index += length * 2;
  }

  if (labels.length === 0) throw new Error('DNS-encoded ENS name was empty');
  return labels.join('.');
}
