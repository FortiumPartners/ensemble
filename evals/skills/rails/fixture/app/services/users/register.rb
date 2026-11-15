module Users
  # Registers a user and gives them the free plan.
  class Register
    Result = Struct.new(:user, :errors, keyword_init: true) do
      def success? = errors.empty?
    end

    def self.call(attrs)
      new(attrs).call
    end

    def initialize(attrs)
      @attrs = attrs
    end

    def call
      user = User.new(@attrs)

      User.transaction do
        user.save && user.accounts.create!(plan: "free")
      end

      Result.new(user: user, errors: user.errors.full_messages)
    end
  end
end
