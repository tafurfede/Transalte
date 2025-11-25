using Amazon.Comprehend;
using Amazon.DynamoDBv2;
using Amazon.S3;
using Amazon.Translate;
using Microsoft.Extensions.DependencyInjection;
using TranslateDemo.Application.UseCases;
using TranslateDemo.Domain.Abstractions;
using TranslateDemo.Infrastructure.Extraction;
using TranslateDemo.Infrastructure.Persistence;
using TranslateDemo.Infrastructure.Storage;
using TranslateDemo.Infrastructure.Translation;
using TranslateDemo.Infrastructure.Xml;

namespace Functions.Shared;

public static class Bootstrap
{
    public static IServiceProvider ServiceProvider { get; } = BuildServices();

    private static IServiceProvider BuildServices()
    {
        var services = new ServiceCollection();

        // AWS clients (default credentials/region)
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());
        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonTranslate>(_ => new AmazonTranslateClient());
        services.AddSingleton<IAmazonComprehend>(_ => new AmazonComprehendClient());

        var bucket = Environment.GetEnvironmentVariable("BUCKET") ?? string.Empty;
        var table = Environment.GetEnvironmentVariable("TABLE_NAME") ?? "TranslateJobs";

        services.AddSingleton<IStorageService>(sp => new S3StorageService(sp.GetRequiredService<IAmazonS3>(), bucket));
        services.AddSingleton<IDownloadUrlSigner>(sp => (S3StorageService)sp.GetRequiredService<IStorageService>());
        services.AddSingleton<IPresignedUploadService>(sp => new S3PresignedUploadService(sp.GetRequiredService<IAmazonS3>(), bucket));
        services.AddSingleton<IJobRepository>(sp => new DynamoJobRepository(sp.GetRequiredService<IAmazonDynamoDB>(), table));
        services.AddSingleton<ITextExtractor, SimpleTextExtractor>();
        services.AddSingleton<ITranslator, AwsTranslator>();
        services.AddSingleton<ILanguageDetector, AwsLanguageDetector>();
        services.AddSingleton<IXmlBuilder, ReportXmlBuilder>();

        services.AddSingleton<CreateUploadUrlUseCase>();
        services.AddSingleton<GetStatusUseCase>();
        services.AddSingleton<ProcessUploadUseCase>();

        return services.BuildServiceProvider();
    }
}

