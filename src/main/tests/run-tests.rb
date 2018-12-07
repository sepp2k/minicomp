checkmark = "✅"
cross = "❌"

Dir.chdir(File.dirname($0))

Dir.chdir("..") do
    if !system("mvn clean && mvn package")
        $stderr.puts("Maven failed with exit code #$?")
        exit 1
    end
end

Dir.glob("**/*.test_suite") do |test_file|
    puts test_file
    puts "=" * test_file.length
    puts
    suite = YAML.load_file(test_file)
    suite.each do |test_name, test_case|

    end
end