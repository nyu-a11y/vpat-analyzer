var VPAT_SOURCE_MIME_TYPES_ = Object.freeze({
  'application/vnd.google-apps.document': 'google-doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf'
});

function vpatSourceTypeForMime_(mimeType) {
  var sourceType = VPAT_SOURCE_MIME_TYPES_[mimeType];
  vpatRequire_(Boolean(sourceType), 'SOURCE_UNSUPPORTED');
  return sourceType;
}

function vpatEligibleSourceQuery_(searchText) {
  var mimeClause = Object.keys(VPAT_SOURCE_MIME_TYPES_).map(function (mimeType) {
    return "mimeType = '" + vpatEscapeDriveQuery_(mimeType) + "'";
  }).join(' or ');
  var normalized = String(searchText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return "trashed = false and (" + mimeClause + ")" +
    (normalized ? " and name contains '" + vpatEscapeDriveQuery_(normalized) + "'" : '');
}

function vpatListEligibleDriveSources_(payload) {
  var pageSize = payload.pageSize === undefined ? 25 : Number(payload.pageSize);
  vpatRequire_(Number.isInteger(pageSize) && pageSize > 0 && pageSize <= VPAT_MAX_SEARCH_RESULTS_, 'INVALID_REQUEST');
  var pageToken = payload.pageToken === undefined || payload.pageToken === null ? null : String(payload.pageToken);
  vpatRequire_(!pageToken || /^[^\u0000-\u001f\u007f]{1,2048}$/.test(pageToken), 'INVALID_REQUEST');
  var options = {
    q: vpatEligibleSourceQuery_(payload.query),
    pageSize: pageSize,
    orderBy: 'modifiedTime desc,name',
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,trashed)',
    spaces: 'drive'
  };
  if (pageToken) options.pageToken = pageToken;
  var response;
  try {
    response = Drive.Files.list(options);
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE', true);
  }
  return {
    schemaVersion: '1.0.0',
    files: (response.files || []).map(function (file) {
      return vpatClientSourceDescriptor_(vpatValidateSourceMetadata_(file, true));
    }),
    nextPageToken: response.nextPageToken || null
  };
}

function vpatInspectSource_(fileId) {
  return vpatReadSourceMetadata_(fileId);
}

function vpatReadSourceMetadata_(fileId) {
  vpatRequire_(typeof fileId === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(fileId), 'INVALID_REQUEST');
  var metadata;
  try {
    metadata = Drive.Files.get(fileId, {
      fields: 'id,name,mimeType,size,modifiedTime,trashed',
      supportsAllDrives: true
    });
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE');
  }
  return vpatValidateSourceMetadata_(metadata);
}

function vpatValidateSourceMetadata_(metadata, allowOversize) {
  vpatRequire_(
    metadata && !metadata.trashed && typeof metadata.id === 'string' &&
    /^[A-Za-z0-9_-]{8,200}$/.test(metadata.id) && typeof metadata.modifiedTime === 'string',
    'SOURCE_INACCESSIBLE'
  );
  var name = String(metadata.name || '').trim();
  vpatRequire_(name.length > 0 && name.length <= 512, 'SOURCE_INACCESSIBLE');
  var sourceType = vpatSourceTypeForMime_(metadata.mimeType);
  var size = null;
  if (sourceType !== 'google-doc') {
    size = Number(metadata.size);
    vpatRequire_(Number.isInteger(size) && size > 0, 'SOURCE_INACCESSIBLE');
    if (!allowOversize) vpatRequire_(size <= VPAT_MAX_SOURCE_BYTES_, 'SOURCE_TOO_LARGE');
  }
  return {
    id: metadata.id,
    name: name,
    mimeType: metadata.mimeType,
    sourceType: sourceType,
    size: size,
    updatedAt: vpatIsoDate_(metadata.modifiedTime)
  };
}

function vpatGetSourceBytes_(metadata) {
  vpatRequire_(metadata.sourceType === 'docx' || metadata.sourceType === 'pdf', 'SOURCE_UNSUPPORTED');
  var file;
  try {
    file = DriveApp.getFileById(metadata.id);
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE');
  }
  var bytes;
  try {
    bytes = file.getBlob().getBytes();
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE', true);
  }
  vpatRequire_(bytes.length > 0 && bytes.length <= VPAT_MAX_SOURCE_BYTES_, 'SOURCE_TOO_LARGE');
  vpatRequire_(bytes.length === metadata.size, 'SOURCE_CHANGED');
  return bytes;
}

function vpatBeginSourceBytes_(requestId, fileId) {
  requestId = vpatRequireRequestId_(requestId);
  var metadata = vpatReadSourceMetadata_(fileId);
  vpatRequire_(metadata.sourceType === 'docx' || metadata.sourceType === 'pdf', 'SOURCE_UNSUPPORTED');
  vpatRequireSelectedSource_(requestId, metadata);
  var existing = vpatGetUserRecord_('source', requestId);
  if (existing) {
    var existingBinding = existing.value;
    vpatRequire_(
      existingBinding && existingBinding.metadata &&
      existingBinding.metadata.id === metadata.id &&
      existingBinding.metadata.sourceType === metadata.sourceType &&
      existingBinding.metadata.updatedAt === metadata.updatedAt &&
      existingBinding.byteLength === metadata.size &&
      existingBinding.chunkBytes === VPAT_SOURCE_CHUNK_BYTES_ &&
      existingBinding.chunkCount === Math.ceil(metadata.size / VPAT_SOURCE_CHUNK_BYTES_) &&
      typeof existingBinding.sha256 === 'string' && /^[a-f0-9]{64}$/.test(existingBinding.sha256),
      'SOURCE_BINDING_CONFLICT'
    );
    return existingBinding;
  }
  var bytes = vpatGetSourceBytes_(metadata);
  var sha256 = vpatSha256Bytes_(bytes);
  var binding = {
    schemaVersion: '1.0.0',
    requestId: requestId,
    metadata: metadata,
    sha256: sha256,
    byteLength: bytes.length,
    chunkBytes: VPAT_SOURCE_CHUNK_BYTES_,
    chunkCount: Math.ceil(bytes.length / VPAT_SOURCE_CHUNK_BYTES_)
  };
  vpatStoreSourceBinding_(binding);
  return binding;
}

function vpatStoreSourceBinding_(binding) {
  vpatWithUserLock_(function () {
    vpatRequireSelectedSource_(binding.requestId, binding.metadata);
    var existing = vpatGetUserRecord_('source', binding.requestId);
    if (existing) {
      var current = existing.value;
      vpatRequire_(
        current.metadata && current.metadata.id === binding.metadata.id &&
        current.metadata.sourceType === binding.metadata.sourceType &&
        current.sha256 === binding.sha256 && current.metadata.updatedAt === binding.metadata.updatedAt,
        'SOURCE_BINDING_CONFLICT'
      );
      return;
    }
    vpatPutUserRecord_('source', binding.requestId, binding);
  });
}

function vpatRequireSelectedSource_(requestId, metadata) {
  vpatRequireActiveRequest_(requestId);
  var requestRecord = vpatGetUserRecord_('request', requestId);
  vpatRequire_(
    requestRecord && requestRecord.value.source &&
    requestRecord.value.status === 'pending' && requestRecord.value.cursor === 0 &&
    requestRecord.value.source.id === metadata.id &&
    requestRecord.value.source.sourceType === metadata.sourceType &&
    requestRecord.value.source.updatedAt === metadata.updatedAt,
    'SOURCE_CHANGED'
  );
  return requestRecord.value.source;
}

function vpatReadSourceByteBatch_(requestId, startChunkIndex, requestedCount) {
  requestId = vpatRequireRequestId_(requestId);
  vpatRequireActiveRequest_(requestId);
  vpatRequire_(Number.isInteger(startChunkIndex) && startChunkIndex >= 0, 'INVALID_REQUEST');
  vpatRequire_(Number.isInteger(requestedCount) && requestedCount > 0 && requestedCount <= VPAT_MAX_CHUNK_BATCH_, 'INVALID_REQUEST');
  var record = vpatGetUserRecord_('source', requestId);
  vpatRequire_(Boolean(record), 'REQUEST_NOT_FOUND');
  var binding = record.value;
  vpatRequireSelectedSource_(requestId, binding.metadata);
  vpatRequire_(binding.metadata.sourceType === 'docx' || binding.metadata.sourceType === 'pdf', 'SOURCE_UNSUPPORTED');
  var metadata = vpatReadSourceMetadata_(binding.metadata.id);
  vpatRequire_(
    metadata.sourceType === binding.metadata.sourceType && metadata.updatedAt === binding.metadata.updatedAt,
    'SOURCE_CHANGED'
  );
  vpatRequire_(metadata.size === binding.byteLength, 'SOURCE_CHANGED');
  var chunkCount = Math.ceil(binding.byteLength / VPAT_SOURCE_CHUNK_BYTES_);
  vpatRequire_(chunkCount === binding.chunkCount && startChunkIndex < chunkCount, 'INVALID_REQUEST');
  var endChunkIndex = Math.min(startChunkIndex + requestedCount, chunkCount);
  var firstByte = startChunkIndex * VPAT_SOURCE_CHUNK_BYTES_;
  var lastByte = Math.min(endChunkIndex * VPAT_SOURCE_CHUNK_BYTES_, binding.byteLength) - 1;
  var rangeBytes = vpatReadCachedOrFetchRange_(
    requestId,
    binding.sha256,
    metadata.id,
    firstByte,
    lastByte,
    binding.byteLength
  );
  vpatRequire_(rangeBytes.length === lastByte - firstByte + 1, 'SOURCE_CHANGED');
  var chunks = [];
  for (var chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex += 1) {
    var relativeStart = (chunkIndex - startChunkIndex) * VPAT_SOURCE_CHUNK_BYTES_;
    var chunk = rangeBytes.slice(
      relativeStart,
      Math.min(relativeStart + VPAT_SOURCE_CHUNK_BYTES_, rangeBytes.length)
    );
    chunks.push({
      chunkIndex: chunkIndex,
      byteLength: chunk.length,
      base64: Utilities.base64Encode(chunk),
      sha256: vpatSha256Bytes_(chunk)
    });
  }
  return {
    schemaVersion: '1.0.0',
    requestId: requestId,
    chunkCount: chunkCount,
    startChunkIndex: startChunkIndex,
    chunks: chunks
  };
}

function vpatSourceChunkCacheKey_(requestId, sourceSha256, chunkIndex) {
  return 'vpat:src:' + vpatRecordKey_(requestId) + ':' + sourceSha256.slice(0, 16) + ':' + chunkIndex;
}

function vpatReadCachedOrFetchRange_(requestId, sourceSha256, fileId, firstByte, lastByte, totalBytes) {
  var firstChunk = Math.floor(firstByte / VPAT_SOURCE_CHUNK_BYTES_);
  var lastChunk = Math.floor(lastByte / VPAT_SOURCE_CHUNK_BYTES_);
  var cache = CacheService.getUserCache();
  var keys = [];
  for (var chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    keys.push(vpatSourceChunkCacheKey_(requestId, sourceSha256, chunkIndex));
  }
  try {
    var cached = cache.getAll(keys);
    if (keys.every(function (key) { return typeof cached[key] === 'string'; })) {
      var cachedRange = [];
      keys.forEach(function (key, index) {
        var decoded = Utilities.base64Decode(cached[key]);
        var absoluteChunk = firstChunk + index;
        var expectedLength = Math.min(
          VPAT_SOURCE_CHUNK_BYTES_,
          totalBytes - absoluteChunk * VPAT_SOURCE_CHUNK_BYTES_
        );
        vpatRequire_(decoded.length === expectedLength, 'SOURCE_CHANGED');
        decoded.forEach(function (byte) { cachedRange.push(byte); });
      });
      if (cachedRange.length === lastByte - firstByte + 1) return cachedRange;
    }
  } catch (ignored) {
    // Cache eviction or corruption causes a bounded authenticated range reacquisition.
  }
  var rangeBytes = vpatFetchDriveByteRange_(fileId, firstByte, lastByte, totalBytes);
  try {
    var entries = {};
    keys.forEach(function (key, index) {
      var offset = index * VPAT_SOURCE_CHUNK_BYTES_;
      entries[key] = Utilities.base64Encode(rangeBytes.slice(
        offset,
        Math.min(offset + VPAT_SOURCE_CHUNK_BYTES_, rangeBytes.length)
      ));
    });
    cache.putAll(entries, 600);
  } catch (ignored) {
    // The transport remains correct if the ephemeral retry cache is unavailable.
  }
  return rangeBytes;
}

function vpatFetchDriveByteRange_(fileId, firstByte, lastByte, totalBytes) {
  vpatRequire_(
    Number.isInteger(firstByte) && Number.isInteger(lastByte) && firstByte >= 0 &&
    lastByte >= firstByte && lastByte < totalBytes && lastByte - firstByte + 1 <= VPAT_SOURCE_CHUNK_BYTES_ * VPAT_MAX_CHUNK_BATCH_,
    'INVALID_REQUEST'
  );
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true',
      {
        method: 'get',
        headers: {
          Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
          Range: 'bytes=' + firstByte + '-' + lastByte
        },
        muteHttpExceptions: true
      }
    );
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE', true);
  }
  var statusCode = response.getResponseCode();
  var requestedWholeFile = firstByte === 0 && lastByte === totalBytes - 1;
  vpatRequire_(statusCode === 206 || (statusCode === 200 && requestedWholeFile), 'SOURCE_CHANGED');
  if (statusCode === 206) {
    var headers = response.getAllHeaders();
    var contentRange = headers['Content-Range'] || headers['content-range'];
    vpatRequire_(
      typeof contentRange === 'string' &&
      contentRange === 'bytes ' + firstByte + '-' + lastByte + '/' + totalBytes,
      'SOURCE_CHANGED'
    );
  }
  return response.getBlob().getBytes();
}
