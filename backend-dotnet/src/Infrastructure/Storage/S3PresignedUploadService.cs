using Amazon.S3;
using Amazon.S3.Model;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Storage;

public sealed class S3PresignedUploadService : IPresignedUploadService
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public S3PresignedUploadService(IAmazonS3 s3, string bucket)
    {
        _s3 = s3;
        _bucket = bucket;
    }

    public Task<PresignedUpload> CreateAsync(string key, string contentType, long maxSizeBytes, CancellationToken ct = default)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.AddMinutes(10),
            ContentType = contentType
        };

        var url = _s3.GetPreSignedURL(request);
        var fields = new Dictionary<string, string> { { "Content-Type", contentType }, { "Content-Length", maxSizeBytes.ToString() } };
        return Task.FromResult(new PresignedUpload(url, fields));
    }
}

