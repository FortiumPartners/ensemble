class Account < ApplicationRecord
  belongs_to :user

  validates :plan, inclusion: { in: %w[free team] }
end
