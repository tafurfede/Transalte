using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;
using Functions.Shared;
using Microsoft.Extensions.DependencyInjection;
using TranslateDemo.Application.Contracts;
using TranslateDemo.Application.UseCases;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace TranslateDemo.Functions.S3;

public class ProcessUploadFunction
{
    private readonly ProcessUploadUseCase _useCase;

    public ProcessUploadFunction() : this(Bootstrap.ServiceProvider.GetRequiredService<ProcessUploadUseCase>()) { }

    public ProcessUploadFunction(ProcessUploadUseCase useCase)
    {
        _useCase = useCase;
    }

    public async Task Handler(S3Event evnt, ILambdaContext context)
    {
        foreach (var record in evnt.Records ?? Enumerable.Empty<S3Event.S3EventNotificationRecord>())
        {
            var bucket = record.S3.Bucket.Name;
            var key = Uri.UnescapeDataString(record.S3.Object.Key);
            if (!key.StartsWith("raw/", StringComparison.OrdinalIgnoreCase)) continue;

            var request = new ProcessUploadRequest(bucket, key);
            await _useCase.HandleAsync(request);
        }
    }
}
